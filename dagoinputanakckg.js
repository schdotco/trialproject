(function () {
'use strict';

/* =========================================================
   CONFIG - VERSI KHUSUS ANAK / REMAJA (FIXED TARGETS)
========================================================= */
const SHEET_ID = '1-We9wNftLhF2Ttd0ukfKpuK2IhM_YTg-mAeScMeDQNI';
const GIDS = ['1783755807', '1121908280'];

// TARGETS dioptimalkan agar ADAPTIF dan sangat presisi dengan nama menu di ASIK
const TARGETS = [
    { id: 'gizi', txt: 'gizi anak' },
    { id: 'tensi', txt: 'tekanan darah anak' },
    { id: 'gula', txt: 'pemeriksaan gula darah anak' },
    { id: 'tb', txt: 'x-ray tb' },
    { id: 'frambusia', txt: 'frambusia' },
    { id: 'kusta', txt: 'kusta' },
    { id: 'skabies', txt: 'skabies' },
    { id: 'telinga_mata', txt: 'telinga dan mata' },
    { id: 'gigi', txt: 'pemeriksaan gigi' },
    { id: 'jasmani', txt: 'kebugaran jasmani' }
];

const sleep = ms => new Promise(r => setTimeout(r,ms));
function normalizeNIK(v) { return String(v || '').replace(/\D/g,''); }

/* =========================================================
   SESSION & DYNAMIC TRACKER
========================================================= */
function saveBOT(data) { 
    try { GM_setValue('AUTO_CKG_ANAK_DATA', JSON.stringify(data)); } 
    catch(e) { localStorage.setItem('AUTO_CKG_ANAK_DATA', JSON.stringify(data)); }
}
function loadBOT() { 
    try { 
        const raw = GM_getValue('AUTO_CKG_ANAK_DATA'); 
        return raw ? JSON.parse(raw) : null; 
    } catch(e) { 
        const raw = localStorage.getItem('AUTO_CKG_ANAK_DATA'); 
        return raw ? JSON.parse(raw) : null; 
    }
}
function clearBOT() { 
    try { GM_deleteValue('AUTO_CKG_ANAK_DATA'); } 
    catch(e) { localStorage.removeItem('AUTO_CKG_ANAK_DATA'); }
}

function getCompleted() { 
    try { return JSON.parse(GM_getValue('AUTO_CKG_ANAK_COMPLETED') || '[]'); }
    catch(e) { return JSON.parse(localStorage.getItem('AUTO_CKG_ANAK_COMPLETED') || '[]'); }
}
function addCompleted(id) {
    const arr = getCompleted();
    if(!arr.includes(id)) arr.push(id);
    try { GM_setValue('AUTO_CKG_ANAK_COMPLETED', JSON.stringify(arr)); }
    catch(e) { localStorage.setItem('AUTO_CKG_ANAK_COMPLETED', JSON.stringify(arr)); }
}
function clearCompleted() { 
    try { GM_deleteValue('AUTO_CKG_ANAK_COMPLETED'); }
    catch(e) { localStorage.removeItem('AUTO_CKG_ANAK_COMPLETED'); }
}

/* =========================================================
   DATA MATCHER
========================================================= */
function parseCSV(text) {
    if (!text) return [];
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
    try {
        const target = normalizeNIK(nikInput);
        
        // Cek apakah data sudah ada di variabel RAM (Halaman yang sama)
        if (!cachedSheetData) {
            
            // --- 1. CEK CACHE DI PENYIMPANAN BROWSER ---
            let savedCache = null;
            let cacheTime = 0;
            const EXPIRATION_TIME = 4 * 60 * 60 * 1000; // Cache bertahan 4 jam (dalam milidetik)
            const now = Date.now();

            try {
                const rawCache = GM_getValue('CKG_SHEET_CACHE');
                cacheTime = parseInt(GM_getValue('CKG_SHEET_CACHE_TIME') || '0');
                if (rawCache) savedCache = JSON.parse(rawCache);
            } catch(e) {
                // Fallback jika GM_getValue diblokir
                const rawCache = sessionStorage.getItem('CKG_SHEET_CACHE');
                cacheTime = parseInt(sessionStorage.getItem('CKG_SHEET_CACHE_TIME') || '0');
                if (rawCache) savedCache = JSON.parse(rawCache);
            }

            // --- 2. JIKA CACHE VALID & BELUM EXPIRED, GUNAKAN CACHE ---
            if (savedCache && savedCache.length > 0 && (now - cacheTime < EXPIRATION_TIME)) {
                console.log('[CACHE READY] Memuat data dari penyimpanan lokal (Cepat)...');
                cachedSheetData = savedCache;
            } 
            // --- 3. JIKA TIDAK ADA CACHE ATAU EXPIRED, DOWNLOAD ULANG ---
            else {
                updateStatus("MENGUNDUH DATA SPREADSHEET...");
                cachedSheetData = [];

                // Looping ke semua GID yang ada di array GIDS
                for (const gid of GIDS) {
                    console.log('Download sheet gid:', gid);
                    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
                    
                    const res = await fetch(url);
                    if (!res.ok) {
                        console.warn(`[WARNING] Gagal terhubung ke GID: ${gid}`);
                        continue;
                    }
                    
                    const csvText = await res.text();
                    if (!csvText) continue;

                    const rows = parseCSV(csvText);
                    if (rows && rows.length > 1) {
                        if (cachedSheetData.length === 0) {
                            cachedSheetData = cachedSheetData.concat(rows);
                        } else {
                            cachedSheetData = cachedSheetData.concat(rows.slice(1));
                        }
                    }
                }
                console.log('[DOWNLOAD SELESAI]', cachedSheetData.length, 'baris didapat.');

                // Simpan hasil download ke Penyimpanan Browser agar bisa dipakai di halaman selanjutnya
                try {
                    GM_setValue('CKG_SHEET_CACHE', JSON.stringify(cachedSheetData));
                    GM_setValue('CKG_SHEET_CACHE_TIME', now.toString());
                } catch(e) {
                    try {
                        sessionStorage.setItem('CKG_SHEET_CACHE', JSON.stringify(cachedSheetData));
                        sessionStorage.setItem('CKG_SHEET_CACHE_TIME', now.toString());
                    } catch (err) {
                        console.warn("Storage browser penuh, data hanya disimpan di RAM sementara.");
                    }
                }
            }
        }

        const rows = cachedSheetData;
        if (!rows || rows.length < 2) return null;

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length < 10) continue; 
            
            const cells = row.map(col => String(col || '').trim());
            const foundNik = normalizeNIK(cells[0] || cells[1] || cells[2]) === target || 
                             cells.find(col => normalizeNIK(col) === target);

            if (foundNik) {
                return {
                    nik: target,
                    nama: cells[7] || '',
                    sistole: cells[37] || '120',
                    diastole: cells[38] || '80',
                    bb: cells[40] || '60',
                    tb: cells[41] || '165',
                    lp: cells[43] || '80',
                    gula: cells[58] || '110',
                    mata: cells[70] || 'Tidak',
                    merokok: cells[71] || '' 
                };
            }
        }
        return null; 
    } catch (error) {
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

/* =========================================================
   SURVEYJS ENGINE: RADIO & DROPDOWN MULTIPLE
========================================================= */
async function selectDropdownSurveyJS(optionText) {
    let success = false;
    const dropdownTrigger = document.querySelector('.sd-dropdown, .sv-dropdown');
    if (dropdownTrigger) {
        dropdownTrigger.click();
        await sleep(1200); 

        const allOptions = [...document.querySelectorAll('.sv-list__item-body, .sd-list__item-body')];
        const targetOpt = allOptions.find(el => 
            (el.innerText || '').toLowerCase().includes(optionText.toLowerCase())
        );

        if (targetOpt) {
            targetOpt.click(); 
            await sleep(800);
            success = true;
        } else {
            dropdownTrigger.click();
        }
    }
    return success;
}

async function isiDropdownSurveyJS(soalSelector, optionText) {
    let success = false;
    const questions = [...document.querySelectorAll('.sd-question, .sv-question')];
    
    const targetQ = questions.find(q => (q.innerText || '').toLowerCase().includes(soalSelector.toLowerCase()));
    if (!targetQ) return false;

    const dropdownTrigger = targetQ.querySelector('.sd-dropdown, .sv-dropdown');
    
    if (dropdownTrigger) {
        dropdownTrigger.click(); 
        await sleep(1200); 

        const allOptions = [...document.querySelectorAll('.sv-list__item-body, .sd-list__item-body')];
        const targetOpt = allOptions.find(el => 
            (el.innerText || '').toLowerCase().includes(optionText.toLowerCase())
        );

        if (targetOpt) {
            targetOpt.click(); 
            await sleep(800);
            success = true;
        } else {
            dropdownTrigger.click(); 
        }
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
            const questionContainer = el.closest('.sd-question, .sv-question, [role="radiogroup"]');
            let isQuestionAnswered = false;
            if (questionContainer) {
                const allRadiosInQuestion = questionContainer.querySelectorAll('input[type="radio"]');
                isQuestionAnswered = Array.from(allRadiosInQuestion).some(r => r.checked);
            }

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

async function handleTelingaMataAnak(data) {
    updateStatus('MENGISI: SKRINING TELINGA & MATA ANAK...');

    await isiDropdownSurveyJS('daya dengar', 'sesuai umur');
    await sleep(800);

    if ((data.mata || '').toLowerCase() === 'ya') {
        await isiDropdownSurveyJS('daya lihat', 'anak kurang');
    } else {
        await isiDropdownSurveyJS('daya lihat', 'anak baik');
    }
    await sleep(800);

    await isiDropdownSurveyJS('serumen impaksi', 'tidak ada serumen');
    await sleep(800);

    await isiDropdownSurveyJS('infeksi telinga', 'tidak ada infeksi');
    await sleep(800);

    if ((data.mata || '').toLowerCase() === 'ya') {
        await isiDropdownSurveyJS('selaput mata merah', 'curiga kelainan');
    } else {
        await isiDropdownSurveyJS('selaput mata merah', 'normal');
    }
    await sleep(800);
}

/* =========================================================
   KLIK KIRIM & VALIDASI SAPU BERSIH 
========================================================= */
function isFormValid() {
    const questions = document.querySelectorAll('.sd-question, .sv-question');
    for (let q of questions) {
        const pertanyaan = q.innerText.toLowerCase();
        if (pertanyaan.includes('pinhole') || pertanyaan.includes('funduskopi') ||
            pertanyaan.includes('foto torax') || pertanyaan.includes('foto toraks')) {
            continue;
        }

        const radios = q.querySelectorAll('input[type="radio"]');
        if (radios.length > 0) {
            const hasSelected = Array.from(radios).some(r => r.checked);
            if (!hasSelected) return { valid: false, container: q };
        }
    }
    return { valid: true };
}

async function klikKirim() {
    updateStatus('Validasi form...');
    await sleep(2000);
    
    let check = isFormValid();
    
    while (!check.valid) {
        updateStatus('Sapu Bersih form kosong...');
        const labels = check.container.querySelectorAll('label');
        let foundDefaultAnswer = false; 

        for (let l of labels) {
            let labelText = (l.innerText || '').toLowerCase().trim();
                if (labelText === 'tidak' || labelText === 'normal' || labelText === 'tidak ada' || 
                labelText === 'sesuai' || labelText === 'baik' || labelText === 'negatif' ||
                labelText.includes('tidak ada ') || labelText.includes('tidak ditemukan')) {
                const input = l.querySelector('input[type="radio"]');
                if (input && !input.checked) {
                    input.click();
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    await sleep(800);
                    foundDefaultAnswer = true;
                    break; 
                }
            }
        }

        if (!foundDefaultAnswer) {
            updateStatus('Terjebak soal dinamis.\nSilakan isi manual lalu klik Kirim.');
            return false; 
        }

        await sleep(1000);
        check = isFormValid(); 
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
   FORM FILLER LOGIC (ADAPTIF 10 TARGET UTAMA)
========================================================= */
async function autoContinueForm() {
    const data = loadBOT();
    if (!data) {
        updateStatus('IDLE\nSiap Digunakan');
        return;
    }

    BOT_RUNNING = true;
    updateStatus('MENUNGGU FORM DIMUAT...');
    
    for(let i = 0; i < 10; i++) {
        if(document.querySelector('.sd-question, .sv-question, input')) break;
        await sleep(1000);
    }
    await sleep(1000); 

    const title = document.body.innerText.toLowerCase();
    const realInputs = [...document.querySelectorAll('input')].filter(el =>
        (!el.type || el.type === 'text' || el.type === 'number') && !el.closest('.ant-select') && !el.closest('.sd-dropdown')
    );

    let currentId = null;

    if(title.includes('gizi anak') || title.includes('imt/u')){
        currentId = 'gizi'; updateStatus('MENGISI TAHAP: GIZI ANAK');
        const inputBB = document.querySelector('input[placeholder*="satuan kg" i]') || document.querySelector('input[placeholder*="Berat Badan" i]') || realInputs[0];
        const inputTB = document.querySelector('input[placeholder*="tinggi badan" i]') || realInputs[1];
        const inputLP = realInputs.find(el => (el.placeholder || '').toLowerCase().includes('hasil pengukuran') && !(el.placeholder || '').toLowerCase().includes('tinggi badan')) || realInputs[2];
        
        if(inputBB) forceInject(inputBB, data.bb); await sleep(800);
        if(inputTB) forceInject(inputTB, data.tb); await sleep(800);
        if(inputLP) forceInject(inputLP, data.lp); await sleep(1000);
    }
    else if(title.includes('pemeriksaan gula darah anak')){
        currentId = 'gula'; updateStatus('MENGISI TAHAP: PEMERIKSAAN GULA DARAH ANAK');
        await pilihSemuaRadioLimit('tidak', 99, true); 
        await sleep(800);
        const inputGula = document.querySelector('input[placeholder*="Isi sesuai hasil" i]') || realInputs[0];
        if (inputGula) forceInject(inputGula, data.gula);
        await sleep(800);
    }
    else if(title.includes('tekanan darah anak')){
        currentId = 'tensi'; updateStatus('MENGISI TAHAP: TEKANAN DARAH ANAK');
        await pilihSemuaRadioLimit('tidak', 99, true); await sleep(800);
        const inSistol = document.querySelector('input[placeholder*="Sistolik" i]') || realInputs[0];
        const inDiastol = document.querySelector('input[placeholder*="Diastolik" i]') || realInputs[1];
        if(inSistol) forceInject(inSistol, data.sistole); await sleep(800);
        if(inDiastol) forceInject(inDiastol, data.diastole); await sleep(1000);
    }
    else if(title.includes('x-ray tb')){
        currentId = 'tb'; updateStatus('MENGISI TAHAP: TUBERKULOSIS ANAK');
        await pilihSemuaRadioLimit('tidak batuk', 1, false); 
        await sleep(800);
        await pilihSemuaRadioLimit('tidak', 99, true); 
        await sleep(800);
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
// RUTE 1: Telinga dan Mata (Anak Sekolah) -> Pakai Radio Button
    else if(title.includes('telinga dan mata - anak sekolah')){
        currentId = 'telinga_mata'; updateStatus('MENGISI TAHAP: TELINGA MATA (ANAK SEKOLAH)');
        
        // Klik semua jawaban yang mengandung kata "Normal" (untuk pendengaran/penglihatan)
        await pilihSemuaRadioLimit('normal', 99, false); 
        await sleep(800);
        
        // Klik semua jawaban yang mengandung kata "Tidak" (untuk serumen/infeksi)
        await pilihSemuaRadioLimit('tidak', 99, false); 
        await sleep(800);
    }
    // RUTE 2: Telinga dan Mata (Balita / Prasekolah) -> Pakai Dropdown
    else if(title.includes('telinga dan mata')){
        currentId = 'telinga_mata';
        await handleTelingaMataAnak(data); 
    }
    else if(title.includes('pemeriksaan gigi')){
        currentId = 'gigi'; updateStatus('MENGISI TAHAP: GIGI ANAK');
        await pilihSemuaRadioLimit('tidak', 1, true);
        await selectDropdownSurveyJS('tidak', 1);
    }
   else if(title.includes('kebugaran jasmani')){
        currentId = 'jasmani'; updateStatus('MENGISI TAHAP: KEBUGARAN JASMANI');
        
        // 1. Ambil data BB dan TB, ubah menjadi angka (float)
        let bb = parseFloat(data.bb) || 0;
        let tb = parseFloat(data.tb) || 0;
        
        // 2. Kalkulator IMT penentu Kebugaran
        let hasilKebugaran = 'Baik'; // Jawaban default aman

        if (bb > 0 && tb > 0) {
            let imt = bb / ((tb / 100) * (tb / 100)); // Rumus IMT
            
            if (imt >= 18.5 && imt <= 22.9) {
                hasilKebugaran = 'Baik';
            } else if ((imt >= 17.0 && imt < 18.5) || (imt > 22.9 && imt <= 24.9)) {
                hasilKebugaran = 'Cukup';
            } else if ((imt >= 16.0 && imt < 17.0) || (imt > 24.9 && imt <= 29.9)) {
                hasilKebugaran = 'Kurang';
            } else if (imt < 16.0 || imt > 29.9) {
                hasilKebugaran = 'Kurang';
            }
        }
        
        // 3. Eksekusi klik dropdown sesuai hasil kalkulasi
        await isiDropdownSurveyJS('kebugaran jasmani', hasilKebugaran);
        await sleep(800);
    }
    
    // Fallback dinamis jika ada form yang tidak masuk route IF di atas (seperti Kebugaran Jasmani)
    if (!currentId) {
        const foundTarget = TARGETS.find(t => title.includes(t.txt));
        if (foundTarget) {
            currentId = foundTarget.id;
            updateStatus(`MENGISI TAHAP: ${foundTarget.txt.toUpperCase()}`);
        }
    }

    if(currentId) addCompleted(currentId);
    
    let kirimSukses = await klikKirim();
    if (kirimSukses) {
        updateStatus('Menunggu sistem pindah halaman...');
    }
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
    updateStatus('MENCARI ANTRIAN...');
    await sleep(2000); 
    
    let nextItem = getNextTarget();
    
    if(!nextItem) {
        await sleep(2000);
        nextItem = getNextTarget();
    }

    if(!nextItem){
        clearBOT(); clearCompleted(); BOT_RUNNING = false;
        updateStatus('SELESAI SEMUA PEMERIKSAAN'); 
        alert('BOT ANAK/REMAJA SUKSES INPUT SEMUA PEMERIKSAAN');
        return;
    }
    
    updateStatus('MEMBUKA TARGET:\n' + nextItem.title.toUpperCase());
    await sleep(1000);
    triggerClick(nextItem.btn);
}

/* =========================================================
   UI MODERN & DRAGGABLE
========================================================= */
let BOT_RUNNING = false;
function updateStatus(text){ const el = document.getElementById('bot-status'); if(el) el.innerText = text; }
function stopBOT(){ BOT_RUNNING = false; clearBOT(); clearCompleted(); updateStatus('BOT DIHENTIKAN. DATA DIRESET.'); }

function createUI(){
    if(document.getElementById('auto-ckg-ui')) return;
    const box = document.createElement('div'); box.id = 'auto-ckg-ui';
    box.innerHTML = `
        <div id="drag-handle">INPUT CKG ANAK & REMAJA</div>
        <div id="bot-status">Menyiapkan Database, Jangan Klik Start !...</div>
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
            border: 1px solid rgba(255, 204, 0, 0.3); border-radius: 16px;
            z-index: 999999999; padding: 15px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            font-family: 'Segoe UI', sans-serif; color: white; cursor: default;
        }
        #drag-handle {
            padding: 5px; text-align: center; font-weight: bold; color: #ffcc00;
            cursor: move; margin-bottom: 10px; border-bottom: 1px solid #333;
        }
        #bot-status {
            background: rgba(0,0,0,0.3); border-radius: 8px; padding: 10px;
            min-height: 50px; margin-bottom: 10px; color: #ffcc00;
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
        #run-bot { background: #ffcc00; color: #000; }
        #run-bot:hover { background: #e6b800; }
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
        updateStatus('MEMULAI BOT ANAK...');
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
    const isFormPage = location.href.includes('form') || location.href.includes('form.kemkes.go.id');
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
                updateStatus('IDLE\nSiap Digunakan');

                if (!cachedSheetData) {
                    cariData('000').then(() => {
                        if (!BOT_RUNNING) {
                            updateStatus('Database Siap !\nKlik START');
                        }
                    }).catch(err => {
                        console.error("Gagal pre-load data dari background:", err);
                    });
                }
            }
        }
    } else {
        updateStatus('GAGAL: Halaman lambat dimuat (Timeout)');
    }
})();

})();
