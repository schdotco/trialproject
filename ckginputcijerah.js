(function () {
'use strict';

/* =========================================================
   CONFIG
========================================================= */
const SHEET_ID = '1gmDrmxOU2Lle7vhoXo-o8DgOp6rbNK1P';
const GID = '1744259778';
   
let BOT_RUNNING = false;

const TARGETS = [
    { id: 'gizi', txt: 'gizi (bb' },
    { id: 'gula', txt: 'gula darah' },
    { id: 'tensi', txt: 'tekanan darah' },
    { id: 'frambusia', txt: 'frambusia' },
    { id: 'kusta', txt: 'kusta' },
    { id: 'skabies', txt: 'skabies' },
    { id: 'telinga_mata', txt: 'telinga dan mata' },
    { id: 'karies', txt: 'karies' },
    { id: 'periodontal', txt: 'periodontal' },
];

const sleep = ms => new Promise(r => setTimeout(r,ms));
function normalizeNIK(v) { return String(v || '').replace(/\D/g,''); }

/* =========================================================
   SESSION & DYNAMIC TRACKER (FIXED UNTUK LOADER EKSTERNAL)
========================================================= */
// Menggunakan try-catch agar jika GM_setValue diblokir oleh master script, 
// ia akan otomatis menggunakan localStorage browser.
const WAKTU_KEDALUWARSA = 60 * 60 * 1000; // 60 menit

function saveBOT(data) { 
    const payload = { waktuSimpan: Date.now(), dataPasien: data };
    try { GM_setValue('AUTO_CKG_DATA', JSON.stringify(payload)); } 
    catch(e) { localStorage.setItem('AUTO_CKG_DATA', JSON.stringify(payload)); }
}

function loadBOT() { 
    let raw;
    try { raw = GM_getValue('AUTO_CKG_DATA'); } 
    catch(e) { raw = localStorage.getItem('AUTO_CKG_DATA'); }
    
    if (!raw) return null;

    try {
        const payload = JSON.parse(raw);
        if (payload.waktuSimpan) {
            const umurData = Date.now() - payload.waktuSimpan;
            if (umurData > WAKTU_KEDALUWARSA) {
                console.log("Sesi bot kedaluwarsa, mereset data...");
                clearBOT();
                return null;
            }
            return payload.dataPasien;
        }
        return payload; // Fallback jika membaca format data lama
    } catch(e) {
        return null;
    }
}

function clearBOT() { 
    try { GM_deleteValue('AUTO_CKG_DATA'); } 
    catch(e) { localStorage.removeItem('AUTO_CKG_DATA'); }
}

function getCompleted() { 
    try { return JSON.parse(GM_getValue('AUTO_CKG_COMPLETED') || '[]'); }
    catch(e) { return JSON.parse(localStorage.getItem('AUTO_CKG_COMPLETED') || '[]'); }
}
function addCompleted(id) {
    const arr = getCompleted();
    if(!arr.includes(id)) arr.push(id);
    try { GM_setValue('AUTO_CKG_COMPLETED', JSON.stringify(arr)); }
    catch(e) { localStorage.setItem('AUTO_CKG_COMPLETED', JSON.stringify(arr)); }
}
function clearCompleted() { 
    try { GM_deleteValue('AUTO_CKG_COMPLETED'); }
    catch(e) { localStorage.removeItem('AUTO_CKG_COMPLETED'); }
}

/* =========================================================
   DATA MATCHER (OPTIMASI DENGAN CACHE)
========================================================= */
let cachedSheetData = null;

async function cariData(nikInput){
    try {
        const target = normalizeNIK(nikInput);
        if (!cachedSheetData) {
            updateStatus("MENGUNDUH DATA SPREADSHEET...");
            const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${GID}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Gagal terhubung ke Google Sheet');
            const txt = await res.text();
            cachedSheetData = JSON.parse(txt.substring(47, txt.length - 2)).table.rows;
        }

        for(const r of cachedSheetData){
            const cells = r.c.map(x => x ? String(x.v || '') : '');
            if(normalizeNIK(cells[0] || cells[11] || cells[2]) === target || cells.find(col => normalizeNIK(col) === target)){
                return {
                    nik: target,
                    nama: cells[7] || '',
                    sistole: cells[37] || '120',
                    diastole: cells[38] || '80',
                    bb: cells[40] || '60',
                    tb: cells[41] || '165',
                    lp: cells[43] || '80',
                    gula: cells[57] || '110',
                    mata: cells[84] || 'Tidak',
                };
            }
        }
        return null; 
    } catch (error) {
        console.error("Terjadi masalah jaringan:", error);
        updateStatus("ERROR JARINGAN: Cek Koneksi");
        return null; 
    }
}

/* =========================================================
   DOM INTERACTOR CORE
========================================================= */
function triggerClick(el){
    if(!el) return;
    el.scrollIntoView({ behavior:'smooth', block:'center' });
    const rect = el.getBoundingClientRect();
    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(type=>{
        el.dispatchEvent(new MouseEvent(type,{ bubbles:true, cancelable:true, clientX: rect.left + 5, clientY: rect.top + 5 }));
    });
    el.click();
}

function forceInject(element, value) {
    if (!element) return;
    
    // 1. Dapatkan "native setter" untuk input agar framework tidak curiga
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    
    // 2. Terapkan nilai menggunakan setter asli
    nativeSetter.call(element, value);
    
    // 3. (PENTING untuk React/SurveyJS) Hapus tracker jika ada
    if (element._valueTracker) {
        element._valueTracker.setValue('');
    }
    
    // 4. Kirim event agar framework melakukan validasi dan update state
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    
    // 5. Trigger BLUR (Seringkali validasi berjalan saat kursor keluar dari kolom)
    element.dispatchEvent(new Event('blur', { bubbles: true }));
    
    element.blur();
}

/* =========================================================
   SURVEYJS DROPDOWN & RADIO ENGINE
========================================================= */
async function selectDropdownSurveyJS(optionText) {
    let success = false;
    const dropdownTrigger = document.querySelector('.sd-dropdown, .sv-dropdown');
    if (dropdownTrigger) {
        triggerClick(dropdownTrigger);
        await sleep(1000);
        const searchInput = document.querySelector('input[type="text"][role="combobox"], input[aria-expanded="true"]');
        if (searchInput) { forceInject(searchInput, 't'); await sleep(500); }
        const targetOpt = [...document.querySelectorAll('.sv-list__item-body, .sd-list__item-body')].find(el =>
            el.innerText.toLowerCase().includes(optionText.toLowerCase())
        );
        if (targetOpt) {
            triggerClick(targetOpt);
            await sleep(500);
            success = true;
        } else triggerClick(dropdownTrigger); 
    }
    return success;
}

async function pilihSemuaRadioLimit(text, limit = 99, exact = false) {
    let clicked = 0;
    const items = [...document.querySelectorAll('label, .ant-radio-wrapper, .sd-item, .sv-item')];
    
    for (const el of items) {
        if (clicked >= limit) break;
        const txt = (el.innerText || '').trim().toLowerCase();
        const target = text.toLowerCase();
        const isMatch = exact ? (txt === target) : txt.includes(target);
        
        if (isMatch) {
            const radio = el.querySelector('input[type="radio"]');
            
            // CEK TUMPANG TINDIH: Cari tahu apakah soal ini sudah dijawab
            const questionContainer = el.closest('.sd-question, .sv-question, [role="radiogroup"]');
            let isQuestionAnswered = false;
            if (questionContainer) {
                const allRadiosInQuestion = questionContainer.querySelectorAll('input[type="radio"]');
                isQuestionAnswered = Array.from(allRadiosInQuestion).some(r => r.checked);
            }

            // Hanya klik jika soal belum dijawab sama sekali
            if (radio && !isQuestionAnswered) {
                radio.click();
                radio.dispatchEvent(new Event('change', { bubbles: true }));
                radio.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(600);
                clicked++;
            }
        }
    }
    return clicked;
}

async function isiRadioSurveyJS(soalSelector, teksJawaban) {
    const questions = [...document.querySelectorAll('.sd-question, .sv-question')];
    const targetQ = questions.find(q => q.innerText.toLowerCase().includes(soalSelector.toLowerCase()));
    if (!targetQ) return false;
    const labels = [...targetQ.querySelectorAll('label')];
    const targetLabel = labels.find(l => l.innerText.toLowerCase().includes(teksJawaban.toLowerCase()));
    if (targetLabel) {
        const input = targetLabel.querySelector('input[type="radio"]');
        if (input && !input.checked) {
            input.click(); input.checked = true;
            input.dispatchEvent(new Event('mousedown', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('click', { bubbles: true }));
            await sleep(800);
            return true;
        }
    }
    return false;
}

async function handleTelingaMata(data) {
    updateStatus('MENGISI: TELINGA & MATA...');

    await isiRadioSurveyJS('serumen impaksi', 'tidak ada serumen impaksi');
    await sleep(500);

    await selectDropdownSurveyJS('tidak ada infeksi');
    await sleep(500);

    await isiRadioSurveyJS('tajam pendengaran', 'normal');
    await sleep(500);

    // ===== LOGIKA MATA =====
   console.log('[MATA]', JSON.stringify(data.mata));
   updateStatus('MATA: ' + JSON.stringify(data.mata));
    if ((data.mata || '').toLowerCase() === 'ya') {

        // Pertanyaan nomor 4
        await isiRadioSurveyJS(
            'tajam penglihatan',
            'curiga gangguan penglihatan'
        );

        // Tunggu pertanyaan nomor 5 muncul
        await sleep(1500);

        // Pertanyaan nomor 5
        await isiRadioSurveyJS(
            'hasil pemeriksaan visus',
            'gangguan penglihatan ringan'
        );

    } else {

        // Pertanyaan nomor 4
        await isiRadioSurveyJS(
            'tajam penglihatan',
            'normal (visus 6/6 - 6/12)'
        );
    }

    await sleep(500);

    await isiRadioSurveyJS('pupil', 'normal');
}

/* =========================================================
   KLIK KIRIM & VALIDASI
========================================================= */
function isFormValid() {
    const questions = document.querySelectorAll('.sd-question, .sv-question');

    for (let q of questions) {

        const pertanyaan = q.innerText.toLowerCase();

        // Abaikan validasi untuk pertanyaan ini
        if (
            pertanyaan.includes('pinhole') ||
            pertanyaan.includes('funduskopi')
        ) {
            continue;
        }

        const radios = q.querySelectorAll('input[type="radio"]');

        if (radios.length > 0) {
            const hasSelected = Array.from(radios).some(r => r.checked);

            if (!hasSelected) {
                return {
                    valid: false,
                    container: q
                };
            }
        }
    }

    return { valid: true };
}

async function klikKirim() {
    updateStatus('Validasi form...');
    await sleep(2000);
    let check = isFormValid();
   while (!check.valid) {
        updateStatus('Mengisi soal kosong...');
        const labels = check.container.querySelectorAll('label');
        for (let l of labels) {
            let labelText = l.innerText.toLowerCase();
            if (labelText.includes('normal') || labelText.includes('tidak')) {
                const input = l.querySelector('input[type="radio"]');
                if (input && !input.checked) {
                    input.click();
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    await sleep(800);
                    break; // Keluar dari loop label jika sudah mengklik satu jawaban
                }
            }
        }
        await sleep(1000);
        check = isFormValid(); // Cek ulang, jika masih ada soal kosong lain, loop berjalan lagi
   }
   const btn = document.querySelector('.sd-navigation__complete-btn') ||
                [...document.querySelectorAll('button')].find(b => (b.innerText||'').toLowerCase().includes('kirim'));
    if (btn) {
        updateStatus('Mengirim data...');
        btn.click();
        await sleep(4000);
        return true;
    } else {
        updateStatus('Tombol kirim tidak ketemu!');
        return false;
    }
}

/* =========================================================
   FORM FILLER LOGIC
========================================================= */
async function autoContinueForm(){
    const data = loadBOT();
    
    // PERBAIKAN FATAL: Jika belum ada data (user baru buka form dan belum tekan start), 
    // ubah status jadi IDLE agar tidak stuck di INISIALISASI
    if(!data) {
        updateStatus('IDLE\nSiap Digunakan (Form)');
        return;
    }

    BOT_RUNNING = true;
    updateStatus('MENGISI FORM...');
    await sleep(3500);

    const title = document.body.innerText.toLowerCase();
    const realInputs = [...document.querySelectorAll('input')].filter(el =>
        (!el.type || el.type === 'text' || el.type === 'number') && !el.closest('.ant-select') && !el.closest('.sd-dropdown')
    );

    let currentId = null;

    if(title.includes('gizi (bb') || title.includes('lingkar perut')){
        currentId = 'gizi'; updateStatus('MENGISI TAHAP: GIZI');
      
      // Menggunakan array find untuk mencegah tabrakan kata "hasil pengukuran" antara TB dan LP
        const inputBB = document.querySelector('input[placeholder*="satuan kg" i]') || document.querySelector('input[placeholder*="Berat Badan" i]') || realInputs[0];
        const inputTB = document.querySelector('input[placeholder*="tinggi badan" i]') || realInputs[1];
        const inputLP = realInputs.find(el => (el.placeholder || '').toLowerCase().includes('hasil pengukuran') && !(el.placeholder || '').toLowerCase().includes('tinggi badan')) || realInputs[2];
        
        if(inputBB) forceInject(inputBB, data.bb); await sleep(800);
        if(inputTB) forceInject(inputTB, data.tb); await sleep(800);
        if(inputLP) forceInject(inputLP, data.lp); await sleep(1000);
    }
    else if(title.includes('gula darah')){
        currentId = 'gula'; updateStatus('MENGISI TAHAP: GULA DARAH');
        await pilihSemuaRadioLimit('tidak', 99, true); await sleep(800);
        if(realInputs[0]) forceInject(realInputs[0], data.gula); await sleep(1000);
    }
    else if(title.includes('tekanan darah')){
        currentId = 'tensi'; updateStatus('MENGISI TAHAP: TEKANAN DARAH');
        await pilihSemuaRadioLimit('tidak', 99, true); await sleep(800);
        const inSistol = document.querySelector('input[placeholder*="Sistolik" i]') || realInputs[0];
        const inDiastol = document.querySelector('input[placeholder*="Diastolik" i]') || realInputs[1];
        if(inSistol) forceInject(inSistol, data.sistole); await sleep(800);
        if(inDiastol) forceInject(inDiastol, data.diastole); await sleep(1000);
    }
    else if(title.includes('frambusia')){
        currentId = 'frambusia'; updateStatus('MENGISI TAHAP: FRAMBUSIA');
        await pilihSemuaRadioLimit('tidak ada', 99, false);
        await selectDropdownSurveyJS('tidak ada');
    }
    else if(title.includes('kusta')){
        currentId = 'kusta'; updateStatus('MENGISI TAHAP: KUSTA');
        await selectDropdownSurveyJS('tidak ada');
    }
    else if(title.includes('skabies')){
        currentId = 'skabies'; updateStatus('MENGISI TAHAP: SKABIES');
        await selectDropdownSurveyJS('tidak ada');
    }
    else if(title.includes('telinga dan mata')){
        currentId = 'telinga_mata';
        await handleTelingaMata(data);
    }
    else if(title.includes('karies')){
        currentId = 'karies'; updateStatus('MENGISI TAHAP: KARIES');
        await pilihSemuaRadioLimit('tidak', 1, true);
        await selectDropdownSurveyJS('tidak', 1);
    }
    else if(title.includes('periodontal')){
        currentId = 'periodontal'; updateStatus('MENGISI TAHAP: PERIODONTAL');
        await pilihSemuaRadioLimit('tidak', 2, true);
        await selectDropdownSurveyJS('tidak', 2);
    }

    if(currentId) addCompleted(currentId);
    await klikKirim();
    updateStatus('Menunggu sistem pindah halaman...');
}

/* =========================================================
   TRACKER ROUTER
========================================================= */
function getNextTarget(){
    const completed = getCompleted();
    const btns = [...document.querySelectorAll('button')].filter(btn => (btn.innerText || '').toLowerCase().includes('input data'));
    for(let btn of btns){
        let parent = btn.parentElement;
        for(let i=0; i<10; i++){
            if(!parent) break;
            const txt = (parent.innerText || '').replace(/\s+/g,' ').trim().toLowerCase();
            const found = TARGETS.find(t => txt.includes(t.txt));
            if(found && !completed.includes(found.id)){
                return { btn: btn, id: found.id, title: found.txt };
            } else if(found) break;
            parent = parent.parentElement;
        }
    }
    return null;
}

async function mainLoopCKG(data){
    const nextItem = getNextTarget();
    if(!nextItem){
        clearBOT(); clearCompleted(); BOT_RUNNING = false;
        updateStatus('SELESAI SEMUA 9 PEMERIKSAAN');
        alert('BOT SUKSES INPUT SEMUA PEMERIKSAAN');
        return;
    }
    updateStatus('MEMBUKA TARGET:\n' + nextItem.title.toUpperCase());
    await sleep(2000);
    triggerClick(nextItem.btn);
}

/* =========================================================
   UI MODERN & DRAGGABLE
========================================================= */
function updateStatus(text){ const el = document.getElementById('bot-status'); if(el) el.innerText = text; }
function stopBOT(){ BOT_RUNNING = false; clearBOT(); clearCompleted(); updateStatus('BOT DIHENTIKAN. DATA DIRESET.'); }

function createUI(){
    if(document.getElementById('auto-ckg-ui')) return;
    const box = document.createElement('div'); box.id = 'auto-ckg-ui';
    box.innerHTML = `
        <div id="drag-handle">INPUT CKG CIJERAH</div>
        <div id="bot-status">Menyiapkan Database, Masukan NIK & Klik Start !...</div>
        <input id="nik-bot" placeholder="Masukkan NIK">
        <div id="btn-wrap">
            <button id="run-bot">START</button><button id="stop-bot">BATAL</button>
        </div>
    `;
    const style = document.createElement('style');
    style.innerHTML = `
        #auto-ckg-ui {
            position: fixed; top: 100px; right: 20px; width: 300px;
            background: rgba(15, 15, 15, 0.85); backdrop-filter: blur(15px);
            border: 1px solid rgba(0, 255, 136, 0.3); border-radius: 16px;
            z-index: 999999999; padding: 15px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            font-family: 'Segoe UI', sans-serif; color: white; cursor: default;
        }
        #drag-handle {
            padding: 5px; text-align: center; font-weight: bold; color: #00ff88;
            cursor: move; margin-bottom: 10px; border-bottom: 1px solid #333;
        }
        #bot-status {
            background: rgba(0,0,0,0.3); border-radius: 8px; padding: 10px;
            min-height: 50px; margin-bottom: 10px; color: #00ff88;
            font-size: 13px; text-align: center; white-space: pre-wrap;
        }
        #nik-bot {
            width: 100%; box-sizing: border-box; padding: 10px; border: none;
            border-radius: 8px; background: #333; color: white; margin-bottom: 10px;
        }
        #btn-wrap { display: flex; gap: 8px; }
        #run-bot, #stop-bot {
            flex: 1; border: none; padding: 10px; border-radius: 8px;
            font-weight: bold; cursor: pointer; transition: 0.2s;
        }
        #run-bot { background: #00ff88; color: #000; }
        #run-bot:hover { background: #00cc6a; }
        #stop-bot { background: #ff4444; color: white; }
    `;
    document.head.appendChild(style); document.body.appendChild(box);

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

        updateStatus('MENGAMBIL DATA SPREADSHEET...');
        const data = await cariData(nik);
        if(!data) return updateStatus('DATA TIDAK DITEMUKAN');

        BOT_RUNNING = true; saveBOT(data); clearCompleted();
        updateStatus('MEMULAI BOT...');
        await sleep(500); await mainLoopCKG(data);
    };
    document.getElementById('stop-bot').onclick = stopBOT;
}

/* =========================================================
   INIT / AUTO RESUME OBSERVER
========================================================= */
setInterval(createUI, 1000);

async function waitForElement(selector, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (document.querySelector(selector)) return true;
        await sleep(500);
    }
    return false;
}

(async () => {
    // Mengecek apakah di halaman menu utama atau halaman form
    const isFormPage = location.href.includes('form') || location.href.includes('form.kemkes.go.id');
    
    // Tunggu elemen muncul agar memastikan halaman ter-load
    const isReady = await waitForElement(isFormPage ? 'input' : 'button', 10000); 
    
    if (isReady) {
        if(isFormPage){
            await autoContinueForm();
        } else {
            const data = loadBOT();
            if(data){
                BOT_RUNNING = true;
                updateStatus('MELANJUTKAN OTOMATIS...\nJangan tekan apapun');
                await sleep(1000);
                await mainLoopCKG(data);
            } else {
                // --- TAMPILAN AWAL ---
                updateStatus('IDLE\nSiap Digunakan');

                // --- FITUR PRE-LOAD BACKGROUND ---
                if (!cachedSheetData) {
                    // Panggil fungsi pencarian TANPA 'await' agar berjalan paralel di background
                    cariData('000').then(() => {
                        // Setelah unduhan selesai, pastikan user belum klik START. 
                        // Jika belum, beri tahu bahwa database sudah siap (cache penuh).
                        if (!BOT_RUNNING) {
                            updateStatus('Database Siap !\nKlik START');
                        }
                    }).catch(err => {
                        console.error("Gagal pre-load data dari background:", err);
                    });
                }
                // ---------------------------------
            }
        }
    } else {
        updateStatus('GAGAL: Halaman lambat dimuat (Timeout)');
    }
})();

})();
