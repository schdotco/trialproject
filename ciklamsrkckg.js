(function (GM_xmlhttpRequest) {
'use strict';
    const request = GM_xmlhttpRequest;

/* =========================================================
   CONFIG SPREADSHEET
========================================================= */
const SHEET_ID = '1aavWN9ScsvRBY1iZj9gY1GQ0AFgBieCe';
const GID = '1054280612';

const sleep = ms => new Promise(r => setTimeout(r,ms));
function normalizeNIK(v) { return String(v || '').replace(/\D/g,''); }

/* =========================================================
   HELPER MAPPING JAWABAN MEROKOK
========================================================= */
function jawabanMerokok(v){
    const text = String(v || '').toLowerCase().trim();
    return (text.includes('ya') || text.includes('rokok') || text.includes('perokok')) ? 'ya' : 'tidak';
}

/* =========================================================
   SESSION & DYNAMIC TRACKER (ANTI-CRASH)
========================================================= */
const WAKTU_KEDALUWARSA = 60 * 60 * 1000; 

function saveBOT(data) { 
    const payload = { waktuSimpan: Date.now(), dataPasien: data };
    try { GM_setValue('AUTO_SKRINING_DATA', JSON.stringify(payload)); }
    catch(e) { 
        try { localStorage.setItem('AUTO_SKRINING_DATA', JSON.stringify(payload)); } catch(err){}
    }
}

function loadBOT() { 
    let raw = null;
    try { raw = GM_getValue('AUTO_SKRINING_DATA'); }
    catch(e) { 
        try { raw = localStorage.getItem('AUTO_SKRINING_DATA'); } catch(err){}
    }
    
    if (!raw) return null;

    try {
        const payload = JSON.parse(raw);
        if (payload.waktuSimpan) {
            const umurData = Date.now() - payload.waktuSimpan;
            if (umurData > WAKTU_KEDALUWARSA) {
                console.log("Sesi kedaluwarsa, menghapus data otomatis...");
                clearBOT(); 
                return null;
            }
            return payload.dataPasien;
        }
        return payload;
    } catch(e) {
        return null;
    }
}

function clearBOT() { 
    try { GM_deleteValue('AUTO_SKRINING_DATA'); GM_deleteValue('CKG_MODE'); }
    catch(e) { 
        try { localStorage.removeItem('AUTO_SKRINING_DATA'); localStorage.removeItem('CKG_MODE'); } catch(err){}
    }
}

function getCompleted() { 
    let raw = null;
    try { raw = GM_getValue('AUTO_SKRINING_COMPLETED'); }
    catch(e) { 
        try { raw = localStorage.getItem('AUTO_SKRINING_COMPLETED'); } catch(err){}
    }
    try { return JSON.parse(raw || '[]'); } catch(e) { return []; }
}

function addCompleted(id) {
    const arr = getCompleted();
    if(!arr.includes(id)) arr.push(id);
    try { GM_setValue('AUTO_SKRINING_COMPLETED', JSON.stringify(arr)); }
    catch(e) { 
        try { localStorage.setItem('AUTO_SKRINING_COMPLETED', JSON.stringify(arr)); } catch(err){}
    }
}

function clearCompleted() { 
    try { GM_deleteValue('AUTO_SKRINING_COMPLETED'); }
    catch(e) { 
        try { localStorage.removeItem('AUTO_SKRINING_COMPLETED'); } catch(err){}
    }
}

/* =========================================================
   DATA MATCHER (ANTI ERROR / FORMAT AMAN)
========================================================= */
function parseCSV(text) {
    const rows = [];
    let row = [];
    let current = "";
    let insideQuote = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];

        if (char === '"') {
            if (insideQuote && next === '"') {
                current += '"';
                i++;
            } else {
                insideQuote = !insideQuote;
            }
        } else if (char === ',' && !insideQuote) {
            row.push(current);
            current = "";
        } else if ((char === '\n' || char === '\r') && !insideQuote) {
            if (current || row.length) {
                row.push(current);
                rows.push(row);
                row = [];
                current = "";
            }
        } else {
            current += char;
        }
    }

    if (current || row.length) {
        row.push(current);
        rows.push(row);
    }
    return rows;
}
    
let cachedSheetData = null;

async function cariData(nikInput) {
    const target = normalizeNIK(nikInput);

    if (!cachedSheetData) {
        console.log('[CACHE MISS] Download spreadsheet');
        const csv = await new Promise(resolve => {
            request({
                method: "GET",
                url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`,
                timeout: 10000,
                onload: r => resolve(r.responseText || ""),
                onerror: () => resolve("")
            });
        });

        cachedSheetData = parseCSV(csv);
        console.log('[CACHE READY]', cachedSheetData.length, 'baris');
    } else {
        console.log('[CACHE HIT] Pakai data RAM');
    }

    const rows = cachedSheetData;
    if (!rows || rows.length < 2) return null;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const nikSheet = normalizeNIK(row[3]);

        if (nikSheet === target) {
            return {
                nik: target,
                perkawinan: rows[i][13] || 'Belum Menikah',
                merokok: (rows[i][21] || '').trim(),
                jiwa1: (row[74] || '').trim() || 'Tidak sama sekali',
                jiwa2: (row[75] || '').trim() || 'Tidak sama sekali',
                jiwa3: (row[76] || '').trim() || 'Tidak sama sekali',
                jiwa4: (row[77] || '').trim() || 'Tidak sama sekali'
            };
        }
    }
    return null;
}

/* =========================================================
   DOM INTERACTOR (SURVEYJS SAFE)
========================================================= */
// FUNGSI INJECT ANGKA (Untuk kolom hari & menit aktivitas fisik)
function forceInject(element, value) {
    if (!element) return;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    nativeSetter.call(element, value);
    if (element._valueTracker) {
        element._valueTracker.setValue('');
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
    element.blur();
}

async function fillRadioSurveyJS(soalText, jawabanText) {
    try {
        const questions = [...document.querySelectorAll('.sd-question, .sv-question, .sd-element, [data-name]')];
        const allElements = [...document.querySelectorAll('*')];
        
        const aliases = {
            'faktor risiko tb': ['faktor risiko tb', 'tuberkulosis', 'tb', 'batuk', 'kontak erat', 'kontak dengan penderita'],
            'kesehatan jiwa': ['depresi', 'cemas', 'merasa sedih', 'minat melakukan aktivitas'],
            'kanker leher rahim': ['kanker leher rahim', 'serviks', 'pap smear', 'iva'],
            'gejala kanker paru': ['batuk dalam jangka waktu yang lama', 'batuk berdarah', 'sesak napas', 'nyeri dada', 'leher bengkak', 'benjolan pada leher', 'tidak sembuh-sembuh']
        };

        const keywords = aliases[soalText] || [soalText];
        const questionNode = allElements.find(el => {
            const txt = (el.textContent || '').toLowerCase();
            return keywords.some(k => txt.includes(k.toLowerCase()));
        });
        
        if (!questionNode) return false;
        
        const targetQ = questionNode.closest('.sd-element') || questionNode.closest('[data-name]') || questionNode.closest('.sd-question') || questionNode;
        if (!targetQ) return false;

        const items = [...targetQ.querySelectorAll('.sd-item, .sv-item')];
        const targetItem = items.find(el => {
            const txt = (el.innerText || '').toLowerCase().trim();
            const target = jawabanText.toLowerCase().trim();
            if (target === 'menikah' && txt === 'belum menikah') return false;
            return txt === target || txt.includes(target);
        });

        if (targetItem) {
            const input = targetItem.querySelector('input[type="radio"]');
            targetItem.scrollIntoView({ behavior: 'smooth', block: 'center' });

            const radioDecorator = targetItem.querySelector('.sd-radio__decorator, .sd-item__decorator');
            if (radioDecorator) radioDecorator.click();
        
            if (input) {
                input.checked = true;
                input.dispatchEvent(new Event('input', { bubbles:true }));
                input.dispatchEvent(new Event('change', { bubbles:true }));
            }
            await sleep(500);
            return true;
        }
    } catch(e) {}
    return false;
}

async function selectDropdownContext(soalText, optionText, typeChar = 't') {
    try {
        const questions = [...document.querySelectorAll('.sd-question, .sv-question, .sd-element, [data-name]')];
        const targetQ = questions.find(q => {
            const qText = (q.innerText || '').toLowerCase();
            return qText.includes(soalText.toLowerCase()) || soalText.toLowerCase().includes(qText);
        });

        if (!targetQ) return false;

        const dropdown = targetQ.querySelector('.sd-dropdown, .sv-dropdown');
        if (!dropdown) return false;

        dropdown.scrollIntoView({ behavior: 'smooth', block: 'center' });
        dropdown.click();
        await sleep(1000);

        const search = document.querySelector('input[type="text"][role="combobox"], input[aria-expanded="true"]');
        if (search && typeChar) {
            search.focus();
            search.value = typeChar;
            search.dispatchEvent(new Event('input', { bubbles: true }));
            search.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(1000);
        }

        const opts = [...document.querySelectorAll('.sv-list__item-body, .sd-list__item-body')];
        const targetOpt = opts.find(el => (el.innerText || '').toLowerCase().includes(optionText.toLowerCase()));

        if (targetOpt) {
            targetOpt.click();
            await sleep(500);
            if (document.activeElement) document.activeElement.blur();
            return true;
        }
        dropdown.click();
    } catch (e) {}
    return false;
}

async function isiKesehatanJiwa(data) {
    const safeData = data || {}; 
    const j1 = safeData?.jiwa1 || 'Tidak sama sekali';
    const j2 = safeData?.jiwa2 || 'Tidak sama sekali';
    const j3 = safeData?.jiwa3 || 'Tidak sama sekali';
    const j4 = safeData?.jiwa4 || 'Tidak sama sekali';

    const semuaPertanyaan = [...document.querySelectorAll('.sd-question, .sd-element')];

    for (const q of semuaPertanyaan) {
        const text = (q.innerText || '').toLowerCase();
        let jawabanSheet = '';

        if (text.includes('bersemangat')) jawabanSheet = j1;
        else if (text.includes('murung') || text.includes('putus asa')) jawabanSheet = j2;
        else if (text.includes('gugup') || text.includes('cemas')) jawabanSheet = j3;
        else if (text.includes('khawatir') || text.includes('mengendalikan')) jawabanSheet = j4;

        if (jawabanSheet.trim() !== '') {
            let kataKunci = '';
            const teksJawaban = jawabanSheet.toLowerCase();
            
            if (teksJawaban.includes('tidak')) kataKunci = 'tidak';
            else if (teksJawaban.includes('kurang')) kataKunci = 'kurang';
            else if (teksJawaban.includes('lebih')) kataKunci = 'lebih';
            else if (teksJawaban.includes('hampir')) kataKunci = 'hampir';

            if (kataKunci !== '') {
                const pilihan = [...q.querySelectorAll('.sd-item, .sv-item')];
                const targetPilihan = pilihan.find(el => (el.innerText || '').toLowerCase().includes(kataKunci));

                if (targetPilihan) {
                    const radio = targetPilihan.querySelector('.sd-radio__decorator') || targetPilihan.querySelector('.sd-item__decorator') || targetPilihan.querySelector('input[type="radio"]');
                    if (radio) {
                        radio.click();
                        await sleep(400); 
                    }
                }
            }
        }
    }
}

async function isiTetanusCatin() {
    const judul = document.body.innerText.toLowerCase();
    if (!judul.includes('riwayat imunisasi tetanus')) return false;

    updateStatus('Mengisi Imunisasi Tetanus Catin...');
    await selectDropdownContext('pernah mendapatkan imunisasi tetanus', 'pernah imunisasi tetanus tetapi tidak ingat berapa kali');
    await sleep(1000);

    const btnKirim = document.querySelector('.sd-navigation__complete-btn') || [...document.querySelectorAll('button,input[type="button"]')].find(el => (el.value || el.innerText || '').toLowerCase().includes('kirim'));
    if (btnKirim) {
        btnKirim.click();
        await sleep(3000);
    }
    return true;
}

/* =========================================================
   CORE LOGIC SKRINING MANDIRI
========================================================= */
async function handleSkriningMandiri(data) {
    const pageText = document.body.innerText.toLowerCase();

    // 1. STATUS PERKAWINAN
    if (pageText.includes('status perkawinan')) {
        updateStatus('Status di Sheet: ' + data.perkawinan); 
        await sleep(1000); 

        if (data.perkawinan && data.perkawinan !== 'Data Kosong') {
            let p = data.perkawinan.toLowerCase();
            let target = 'Menikah'; 

            if (p.includes('belum')) target = 'Belum Menikah';
            else if (p.includes('cerai')) target = 'Cerai'; 
            
            updateStatus('Mengisi: ' + target);
            await fillRadioSurveyJS('status perkawinan', target);
            await sleep(1000);
        } else {
            updateStatus('Data Perkawinan Kosong!');
            await sleep(1000);
        }
    }
    
    // FAKTOR RISIKO TB
    if (pageText.includes('faktor risiko tb') || pageText.includes('tuberkulosis')) {
        await fillRadioSurveyJS('faktor risiko tb', 'tidak batuk');
        await fillRadioSurveyJS('faktor risiko tb', 'tidak');
    }
    
    // 2. DISABILITAS
    if (pageText.includes('disabilitas')) {
        await fillRadioSurveyJS('disabilitas', 'non disabilitas');
    }

    // KESEHATAN JIWA (Perbaikan penambahan parameter 'data')
    if (pageText.includes('2 minggu terakhir') || pageText.includes('kesehatan jiwa')) {
        await isiKesehatanJiwa(data);
    }

    // 3. KANKER LEHER RAHIM
    if (pageText.includes('kanker leher rahim')) {
        let p = (data.perkawinan || '').toLowerCase();
        let isYes = p.includes('menikah') || p.includes('cerai') || (p.includes('kawin') && !p.includes('belum'));
        await fillRadioSurveyJS('kanker leher rahim', isYes ? 'ya' : 'tidak');
    }

    // 4. MEROKOK & KANKER
    if (pageText.includes('merokok') || pageText.includes('kanker paru')) {
        const statusMerokok = jawabanMerokok(data.merokok);
        await fillRadioSurveyJS('merokok dalam setahun terakhir', statusMerokok);
        await fillRadioSurveyJS('riwayat merokok dalam 15 tahun terakhir', statusMerokok);
        await fillRadioSurveyJS('menghirup asap rokok', 'tidak');
        await fillRadioSurveyJS('kanker paru pada keluarga', 'tidak');
        await fillRadioSurveyJS('batuk dalam jangka waktu yang lama', 'tidak');
        await fillRadioSurveyJS('riwayat penyakit tbc atau ppok', 'tidak');
        await fillRadioSurveyJS('gejala kanker paru', 'tidak');
    }

    // 5. SAPU BERSIH (Isi radio yang KOSONG menjadi default)
    const questions = document.querySelectorAll('.sd-question, .sv-question, .sd-element, [data-name]');
    questions.forEach(q => {
        let isAnswered = false;
        q.querySelectorAll('input[type="radio"]').forEach(radio => {
            if (radio.checked) isAnswered = true;
        });

        if (isAnswered) return;

        let qText = (q.innerText||'').toLowerCase();
        if (qText.match(/aktivitas fisik/)) return; 

        q.querySelectorAll('label').forEach(l => {
            let txt = (l.innerText||'').toLowerCase().trim();
            if (txt === 'tidak' || txt === 'normal' || txt === 'tidak ada') {
                let i = l.querySelector('input[type="radio"]');
                if (i && !i.checked) { 
                    i.click(); 
                    i.checked = true; 
                    i.dispatchEvent(new Event('input', { bubbles:true }));
                    i.dispatchEvent(new Event('change', { bubbles:true }));
                }
            }
        });
    });

    // 6. AKTIVITAS FISIK (Modifikasi dengan injeksi angka)
    if (pageText.includes('aktivitas fisik')) {
        updateStatus('Mengisi Aktivitas Fisik...');

        // 1. Jawab "Ya" khusus untuk aktivitas fisik rumah tangga/domestik
        await selectDropdownContext('aktivitas fisik sedang pada kegiatan rumah tangga/domestik seperti membersihkan rumah/lingkungan (menyapu, menata perabotan), mencuci baju manual, memasak, mengasuh anak, atau mengangkat beban dengan berat < 20 kg?', 'ya');
        
        // Wajib tunggu sejenak agar animasi SurveyJS memunculkan kotak angka
        await sleep(1500); 

        // 2. Ambil semua pertanyaan yang ada di layar
        const allQuestions = [...document.querySelectorAll('.sd-question, .sv-question')];
        
        // 3. Cari dan isi angka 4 untuk pertanyaan "Berapa hari"
        const qHari = allQuestions.find(q => (q.innerText || '').toLowerCase().includes('berapa hari dalam satu minggu anda melakukan aktivitas tersebut?'));
        if (qHari) {
            const inputHari = qHari.querySelector('input[type="number"]');
            if (inputHari) {
                forceInject(inputHari, '4');
                await sleep(500);
            }
        }

        // 4. Cari dan isi angka 30 untuk pertanyaan "Berapa menit"
        const qMenit = allQuestions.find(q => (q.innerText || '').toLowerCase().includes('dalam satu hari berapa menit waktu yang digunakan untuk melakukan aktivitas tersebut?'));
        if (qMenit) {
            const inputMenit = qMenit.querySelector('input[type="number"]');
            if (inputMenit) {
                forceInject(inputMenit, '30');
                await sleep(500);
            }
        }

        // 5. Sapu bersih sisa dropdown lain dengan "Tidak"
        const dropdowns = [...document.querySelectorAll('.sd-dropdown, .sv-dropdown')];
        for (let i = 0; i < dropdowns.length; i++) {
            const currentDropdown = dropdowns[i];
            if (!currentDropdown) continue;
            
            const val = (currentDropdown.innerText || '').trim().toLowerCase();
            if (val === 'ya') continue;

            currentDropdown.scrollIntoView({ behavior: 'smooth', block: 'center' });
            currentDropdown.click();
            await sleep(1200);

            const opsiTidak = [...document.querySelectorAll('li.sv-list__item, li.sd-list__item')]
                .find(li => (li.innerText || '').trim().toLowerCase() === 'tidak');

            if (opsiTidak) {
                opsiTidak.click();
                opsiTidak.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                await sleep(600);
            } else {
                currentDropdown.click();
            }
        }
    }

    // 7. NAVIGASI
    await sleep(1500); 
    const btnNext = document.querySelector('.sd-navigation__next-btn, .sd-navigation__complete-btn') || [...document.querySelectorAll('button')].find(b => (b.innerText||'').toLowerCase().match(/lanjut|kirim/));

    if (btnNext) {
        btnNext.click();
        await sleep(3500);
    }
}

/* =========================================================
   FORM LOOP ROUTER
========================================================= */
let BOT_RUNNING = false;

async function autoContinueForm(){
    const data = loadBOT();
    if(!data) return;

    BOT_RUNNING = true;
    updateStatus('MEMULAI PENGISIAN...');
    await sleep(3000);

    while (BOT_RUNNING && location.host.includes("form.kemkes.go.id")) {
        try {
            if (document.body.innerText.toLowerCase().includes('riwayat imunisasi tetanus')) {
                await isiTetanusCatin();
            } else {
                await handleSkriningMandiri(data);
            }
        } catch(e) {
            console.error("Error bypass:", e);
            updateStatus("Melewati error, mencoba ulang...");
        }
        await sleep(2000);
    }
}

/* =========================================================
   DASHBOARD TRACKER
========================================================= */
function getNextTarget(){
    const completed = getCompleted();
    const btns = [...document.querySelectorAll('button')].filter(btn => {
        const txt = (btn.innerText || '').toLowerCase();
        return txt.includes('skrining mandiri') || txt.includes('input data') || txt.includes('tambah');
    });

    for(let btn of btns){
        let parent = btn.parentElement;
        for(let i=0; i<6; i++){
            if(!parent) break;
            let txt = (parent.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (txt.length > 10) {
                let id = txt.substring(0, 35);
                if(!completed.includes(id)){
                    return { btn: btn, id: id, title: txt.substring(0, 25) };
                }
                break;
            }
            parent = parent.parentElement;
        }
    }
    return null;
}

async function mainLoop(data) {
    updateStatus('MENCARI ANTRIAN...');
    while (BOT_RUNNING && location.hostname.includes('sehatindonesiaku')) {
        let nextItem = null;

        for (let i = 0; i < 3; i++) {
            nextItem = getNextTarget(); 
            if (nextItem) break; 
            await sleep(2000);
        }

        if (!nextItem) {
            BOT_RUNNING = false;
            clearBOT();
            clearCompleted();
            updateStatus('SELESAI SEMUA TARGET.\nSilakan ganti NIK untuk pasien baru.');
            alert('Semua antrian pemeriksaan selesai!');
            break;
        }

        updateStatus('MEMBUKA TARGET:\n' + nextItem.title.toUpperCase());
        addCompleted(nextItem.id); 
        nextItem.btn.click();
        await sleep(5000); 
    }
}

/* =========================================================
   UI MODERN & DRAGGABLE
========================================================= */
function updateStatus(text){ const el = document.getElementById('bot-status'); if(el) el.innerText = text; }
function stopBOT(){ BOT_RUNNING = false; clearBOT(); clearCompleted(); updateStatus('BOT DIHENTIKAN & NIK DIHAPUS.'); }

function createUI(){
    if(document.getElementById('auto-ckg-ui')) return;
    const box = document.createElement('div'); box.id = 'auto-ckg-ui';
    box.innerHTML = `
        <div id="drag-handle">SKRINING MANDIRI CIKUTRA LAMA</div>
        <div id="bot-status">Menyiapkan Database...</div>
        <input id="nik-bot" placeholder="Masukkan NIK">
        <div id="btn-wrap">
            <button id="run-bot">START</button><button id="stop-bot">BATAL</button>
        </div>
    `;
    const style = document.createElement('style');
    style.innerHTML = `
        #auto-ckg-ui {
            position: fixed; top: 100px; right: 20px; width: 300px;
            background: rgba(15, 15, 15, 0.95); backdrop-filter: blur(15px);
            border: 1px solid rgba(0, 200, 255, 0.5); border-radius: 16px;
            z-index: 999999999; padding: 15px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            font-family: 'Segoe UI', sans-serif; color: white; cursor: default;
        }
        #drag-handle { padding: 5px; text-align: center; font-weight: bold; color: #00c8ff; cursor: move; margin-bottom: 10px; border-bottom: 1px solid #333; }
        #bot-status { background: rgba(0,0,0,0.4); border-radius: 8px; padding: 10px; min-height: 50px; margin-bottom: 10px; color: #00c8ff; font-size: 13px; text-align: center; white-space: pre-wrap; }
        #nik-bot { width: 100%; box-sizing: border-box; padding: 10px; border: none; border-radius: 8px; background: #333; color: white; margin-bottom: 10px; }
        #btn-wrap { display: flex; gap: 8px; }
        #run-bot, #stop-bot { flex: 1; border: none; padding: 10px; border-radius: 8px; font-weight: bold; cursor: pointer; transition: 0.2s; }
        #run-bot { background: #00c8ff; color: #000; }
        #run-bot:hover { background: #009acc; }
        #stop-bot { background: #ff4444; color: white; }
    `;
    document.head.appendChild(style); document.body.appendChild(box);

    const savedData = loadBOT();
    if(savedData && savedData.nik) document.getElementById('nik-bot').value = savedData.nik;

    const handle = document.getElementById('drag-handle');
    if(handle){
        let isDragging = false, offsetX, offsetY;
        handle.onmousedown = (e)=>{ isDragging = true; offsetX = e.clientX - box.offsetLeft; offsetY = e.clientY - box.offsetTop; };
        document.onmousemove = (e)=>{ if(isDragging){ box.style.left = (e.clientX - offsetX) + 'px'; box.style.top = (e.clientY - offsetY) + 'px'; box.style.right = 'auto'; } };
        document.onmouseup = ()=>{ isDragging = false; };
    }

    document.getElementById('run-bot').onclick = async ()=>{
        if(BOT_RUNNING) return alert('BOT SEDANG BERJALAN');
        const nik = document.getElementById('nik-bot').value;
        if(!nik) return alert('Masukkan NIK');

        updateStatus('MENCARI NIK DI SPREADSHEET...');
        const data = await cariData(nik);

        if(!data) {
            return updateStatus('NIK TIDAK DITEMUKAN DI GOOGLE SHEETS');
        }

        BOT_RUNNING = true;
        saveBOT(data);
        clearCompleted(); 

        updateStatus(`Data Ketemu!\nPerkawinan: ${data.perkawinan}`);
        await sleep(500);

        await mainLoop(data);
    };
    document.getElementById('stop-bot').onclick = stopBOT;
}

/* =========================================================
   INIT / PINTU UTAMA (ANTI CRASH)
========================================================= */

// Pastikan UI hanya dirender jika halaman Kemenkes sudah berwujud (tidak nge-blank)
function safeCreateUI() {
    if (document.body) {
        createUI();
    }
}
setInterval(safeCreateUI, 1000);

// Gunakan listener 'load' agar script jalan pasca-render, jangan pakai setTimeout asal-asalan
window.addEventListener('load', async () => {
    await sleep(1500); // Beri nafas untuk Framework webnya
    
    const isFormPage = location.href.includes('form.kemkes.go.id');
    const isMainPage = location.href.includes('sehatindonesiaku');

    if(isFormPage) {
        await autoContinueForm();
    } else if (isMainPage) {
        const data = loadBOT();
        if(data){
            BOT_RUNNING = true;
            updateStatus('MELANJUTKAN OTOMATIS...\nMencari Form Berikutnya');
            await sleep(3000);
            await mainLoop(data);
        } else {
            updateStatus('Menyiapkan Data\nMasukkan NIK lalu Tunggu sampai Database siap sebelum klik START');
        }

        if (!cachedSheetData) {
            cariData('000').then(() => {
                if (!BOT_RUNNING) {
                    updateStatus('Database Siap !\nklik START');
                }
            }).catch(err => {
                console.error("Gagal mendownload background data:", err);
            });
        }
    }
});

})(typeof GM_xmlhttpRequest !== "undefined" ? GM_xmlhttpRequest : null);
