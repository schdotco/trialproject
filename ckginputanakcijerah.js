(function () {
'use strict';

/* =========================================================
   CONFIG - VERSI KHUSUS ANAK / REMAJA (FIXED TARGETS)
========================================================= */
const SHEET_ID = '1gmDrmxOU2Lle7vhoXo-o8DgOp6rbNK1P';
const GIDS = ['1744259778'];

// TARGETS dioptimalkan agar ADAPTIF dan sangat presisi dengan nama menu di ASIK
// [UPDATE]: Menambahkan koma yang tertinggal di baris akhir
const TARGETS = [
    { id: 'gizi', txt: 'gizi anak' },
    { id: 'gizi_balita', txt: 'pertumbuhan' },
    { id: 'tensi', txt: 'tekanan darah anak' },
    { id: 'gula', txt: 'pemeriksaan gula darah anak' },
    { id: 'tb', txt: 'x-ray tb' },
    { id: 'frambusia', txt: 'frambusia' },
    { id: 'kusta', txt: 'kusta' },
    { id: 'skabies', txt: 'skabies' },
    { id: 'telinga_mata', txt: 'telinga dan mata' },
    { id: 'gigi', txt: 'hasil pemeriksaan gigi' },
    { id: 'jasmani', txt: 'kebugaran jasmani' },
    { id: 'serumen', txt: 'serumen impaksi' },
    { id: 'infeksi', txt: 'infeksi telinga' },
    { id: 'selaput', txt: 'selaput mata merah' },
    { id: 'visus', txt: 'pemeriksaan visus' },
    { id: 'kacamata', txt: 'kacamata' },
    { id: 'kebugaran', txt: 'kebugaran' },
    { id: 'merokok', txt: 'merokok' }
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
   INDEXEDDB CACHE HELPER
========================================================= */
const DB_NAME = 'CKG_CACHE_DB';
const STORE_NAME = 'SheetDataStore';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getCacheDB(key) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        return null;
    }
}

async function setCacheDB(key, value) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(value, key);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        return false;
    }
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
        
        if (!cachedSheetData || cachedSheetData.length === 0) {
            
            let savedCache = null;
            let cacheTime = 0;
            const EXPIRATION_TIME = 4 * 60 * 60 * 1000;
            const now = Date.now();

            try {
                savedCache = await getCacheDB('CKG_SHEET_DATA');
                cacheTime = await getCacheDB('CKG_SHEET_TIME') || 0;
            } catch(e) {
                console.warn("Gagal membaca IndexedDB", e);
            }

            if (savedCache && savedCache.length > 0 && (now - cacheTime < EXPIRATION_TIME)) {
                console.log('[CACHE READY] Memuat data dari IndexedDB...');
                cachedSheetData = savedCache;
            } 
            else {
                updateStatus("MENGUNDUH DATA SPREADSHEET...");
                cachedSheetData = [];
                
                for (const gid of GIDS) {
                    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
                    const res = await fetch(url);
                    if (!res.ok) continue;
                    
                    const csvText = await res.text();
                    if (!csvText) continue;
                    
                    const rows = parseCSV(csvText);
                    if (rows && rows.length > 1) {
                        if (cachedSheetData.length === 0) {
                            cachedSheetData = rows;
                        } else {
                            for (let i = 1; i < rows.length; i++) {
                                cachedSheetData.push(rows[i]);
                            }
                        }
                    }
                }
                
                console.log('[DOWNLOAD SELESAI]', cachedSheetData.length, 'baris didapat.');

                try {
                    await setCacheDB('CKG_SHEET_DATA', cachedSheetData);
                    await setCacheDB('CKG_SHEET_TIME', now);
                    console.log('[INFO] Database besar berhasil disimpan ke IndexedDB agar aman dari limit RAM.');
                } catch(e) {
                    console.warn("Gagal menyimpan ke IndexedDB.", e);
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
                    sistole: cells[37] || '',
                    diastole: cells[38] || '',
                    bb: cells[40] || '',
                    tb: cells[41] || '',
                    lp: cells[43] || '',
                    gula: cells[57] || '',
                    mata: cells[84] || 'Tidak',
                    
                    // [UPDATE DINAMIS]: Pengambilan Data Skrining Telinga, Mata, Kebersihan Diri & Kebugaran
                    gigi: cells[80] || 'Tidak',                 // CC: Pemeriksaan Gigi
                    serumenKanan: cells[81] || 'Tidak ada',     // CD: Serumen Kanan
                    serumenKiri: cells[82] || 'Tidak ada',      // CE: Serumen Kiri
                    infeksiKanan: cells[83] || 'Tidak ada',     // CF: Infeksi Kanan
                    infeksiKiri: cells[84] || 'Tidak ada',      // CG: Infeksi Kiri
                    pendengaranKanan: cells[85] || 'Normal',    // CH: Tajam Pendengaran Kanan
                    pendengaranKiri: cells[86] || 'Normal',     // CI: Tajam Pendengaran Kiri
                    selaputKanan: cells[87] || 'Normal',        // CJ: Selaput Mata Merah Kanan
                    selaputKiri: cells[88] || 'Normal',         // CK: Selaput Mata Merah Kiri
                    visusKanan: cells[89] || 'Normal',          // CL: Visus Kanan
                    visusKiri: cells[90] || 'Normal',           // CM: Visus Kiri
                    kacamata: cells[91] || 'Tidak',             // CN: Penggunaan Kacamata
                    kusta: cells[92] || 'Tidak ada',            // CO: Kusta (Bercak kulit)
                    skabies: cells[93] || 'Tidak ada',          // CP: Skabies (Koreng/ruam)
                    frambusia: cells[94] || 'Tidak ada',        // CQ: Frambusia (Papul/nodul)
                    kebugaran: cells[95] || 'Baik',             // CR: Kebugaran Jasmani
                    merokok: cells[96] || 'Tidak'               // CS: Perilaku Merokok
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

    const valEl = targetQ.querySelector('.sd-dropdown__value, input.sd-dropdown__filter-string-input');
    if (valEl && (valEl.value || valEl.innerText || '').toLowerCase().includes(optionText.toLowerCase())) {
        return true; 
    }

    const dropdownTrigger = targetQ.querySelector('.sd-dropdown, .sv-dropdown');
    
    if (dropdownTrigger) {
        dropdownTrigger.scrollIntoView({ behavior: 'smooth', block: 'center' });
        dropdownTrigger.click(); 
        await sleep(1000); 

        const allOptions = [...document.querySelectorAll('.sv-list__item-body, .sd-list__item-body')];
        const targetOpt = allOptions.find(el => 
            el.offsetParent !== null && 
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

    // [UPDATE DINAMIS] Menarik string langsung dari database
    await isiDropdownSurveyJS('daya dengar', data.pendengaranKanan);
    await sleep(800);

    await isiDropdownSurveyJS('daya lihat', data.visusKanan);
    await sleep(800);

    await isiDropdownSurveyJS('serumen impaksi', data.serumenKanan);
    await sleep(800);

    await isiDropdownSurveyJS('infeksi telinga', data.infeksiKanan);
    await sleep(800);

    await isiDropdownSurveyJS('selaput mata merah', data.selaputKanan);
    await sleep(800);
}

async function handleTelingaMataBalita(data) {
    updateStatus('MENGISI: SKRINING TELINGA & MATA BALITA...');
    await sleep(1000);

    // [UPDATE DINAMIS] Menarik string langsung dari database
    const jawabanBalita = [
        data.pendengaranKanan || "Sesuai Umur", 
        data.visusKanan || ((data.mata || '').toLowerCase() === 'ya' ? "Daya lihat anak kurang" : "Daya lihat anak baik"), 
        data.serumenKanan || "Tidak ada serumen impaksi", 
        data.infeksiKanan || "Tidak ada infeksi telinga", 
        data.selaputKanan || "Normal"
    ];

    const semuaSoal = [...document.querySelectorAll('.sd-question, .sv-question, .sd-element')].filter(q => q.offsetParent !== null);

    for (let i = 0; i < semuaSoal.length; i++) {
        const soal = semuaSoal[i];
        const targetJawaban = jawabanBalita[i];
        
        if (!targetJawaban) continue;

        soal.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(500);

        const dropdown = soal.querySelector('.sd-dropdown, .sv-dropdown');
        if (dropdown) {
            const teksKotak = (dropdown.innerText || '').toLowerCase().trim();
            if (teksKotak.includes(targetJawaban.toLowerCase())) {
                continue;
            }

            dropdown.click();
            await sleep(1000);

            const allOptions = [...document.querySelectorAll('.sv-list__item-body, .sd-list__item-body, .sv-list__item, .sd-list__item')]
                .filter(el => {
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                });

            const targetOpt = allOptions.find(el => 
                (el.innerText || '').toLowerCase().trim().includes(targetJawaban.toLowerCase())
            );

            if (targetOpt) {
                targetOpt.click();
                console.log(`[BOT] Sukses mengisi pertanyaan balita ke-${i + 1} dengan: "${targetJawaban}"`);
                await sleep(1200);
            } else {
                dropdown.click();
                await sleep(500);
            }
        }
    }
    await sleep(1000);
}

async function handlePemeriksaanGigi(data) {
    updateStatus('MENGISI TAHAP: PEMERIKSAAN GIGI...');
    
    // [UPDATE DINAMIS] Menarik string langsung dari database
    await pilihSemuaRadioLimit(data.gigi, 99, false);
    await sleep(500);
    
    // Eksekusi untuk sisa Dropdown
    const dropdowns = [...document.querySelectorAll('.sd-dropdown, .sv-dropdown')];
    
    for (let i = 0; i < dropdowns.length; i++) {
        const drop = dropdowns[i];
        if (!drop) continue;

        drop.scrollIntoView({ behavior: 'smooth', block: 'center' });
        drop.click();
        await sleep(800); 

        const options = [...document.querySelectorAll('.sv-list__item-body, .sd-list__item-body')];
        const targetOpt = options.find(el => {
            if (el.offsetParent === null) return false;
            const txt = (el.innerText || '').toLowerCase().trim();
            return txt.includes(data.gigi.toLowerCase()) || txt.includes('normal') || txt.includes('tidak');
        });

        if (targetOpt) {
            targetOpt.click();
            await sleep(500);
        } else {
            drop.click();
            await sleep(300);
        }
    }
}

/* =========================================================
   KLIK KIRIM & VALIDASI SAPU BERSIH 
========================================================= */
function isFormValid() {
    const questions = document.querySelectorAll('.sd-question, .sv-question');
    for (let q of questions) {
        if (q.offsetParent === null) continue;

        const pertanyaan = (q.innerText || '').toLowerCase();
        if (pertanyaan.includes('pinhole') || pertanyaan.includes('funduskopi') ||
            pertanyaan.includes('foto torax') || pertanyaan.includes('foto toraks')) {
            continue;
        }

        const radios = q.querySelectorAll('input[type="radio"]');
        if (radios.length > 0) {
            const hasSelected = Array.from(radios).some(r => r.checked);
            if (!hasSelected) return { valid: false, container: q };
        }

        const dropdowns = q.querySelectorAll('.sd-dropdown, .sv-dropdown');
        for (let dd of dropdowns) {
            const valText = (dd.innerText || '').toLowerCase().trim();
            if (valText === 'select...' || valText === 'pilih...' || valText === '') {
                return { valid: false, container: q };
            }
        }
    }
    return { valid: true };
}

async function klikKirim() {
    updateStatus('Mengirim data form...');
    await sleep(1000);

    const btn = document.querySelector('.sd-navigation__complete-btn') ||
                [...document.querySelectorAll('button')].find(b => (b.innerText || '').toLowerCase().includes('kirim'));
    
    if (!btn) {
        updateStatus('Tombol kirim tidak ketemu!');
        return false;
    }

    const currentUrl = location.href;
    btn.click();
    updateStatus('Menunggu respon validasi...');

    let isSuccess = false;
    for (let i = 0; i < 8; i++) {
        await sleep(500);
        if (location.href !== currentUrl || !document.body.contains(btn)) {
            isSuccess = true;
            break;
        }
    }

    if (isSuccess) {
        updateStatus('Kirim Berhasil! Berpindah halaman...');
        await sleep(2000);
        return true;
    } else {
        updateStatus('⚠️ Validasi Gagal!\nCek tanda merah pada soal yang belum terjawab.');
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

    if (title.includes('telinga dan mata')) {
        currentId = 'telinga_mata';
        
        if (title.includes('skrining telinga dan mata - balita') || title.includes('balita dan anak prasekolah')) {
            await handleTelingaMataBalita(data); 
        } else {
            // [UPDATE DINAMIS] Menarik string radio button telinga & mata
            updateStatus('MENGISI TAHAP: TELINGA & MATA (ANAK/DEWASA)');
            await pilihSemuaRadioLimit(data.selaputKanan, 99, false); 
            await sleep(800);
            await pilihSemuaRadioLimit(data.infeksiKanan, 99, false); 
            await sleep(800);
        }
    }
    else if (title.includes('skrining pertumbuhan - balita') || title.includes('balita dan anak prasekolah')) {
        currentId = 'gizi_balita'; 
        updateStatus('MENGISI TAHAP: SKRINING PERTUMBUHAN BALITA');
        
        const inputBB = document.querySelector('input[placeholder*="kilogram" i]') || realInputs[0];
        if (inputBB) forceInject(inputBB, data.bb); 
        await sleep(800);

        const inputTB = document.querySelector('input[placeholder*="tinggi badan" i]') || realInputs[1];
        if (inputTB) forceInject(inputTB, data.tb); 
        await sleep(800);

        await isiDropdownSurveyJS('posisi pengukuran', 'berdiri');
        await sleep(800);

        await isiDropdownSurveyJS('lingkar kepala', 'normal');
        await sleep(800);
    }
    else if (title.includes('gizi anak') || title.includes('imt/u')) {
        currentId = 'gizi'; updateStatus('MENGISI TAHAP: GIZI ANAK');
        
        const inputBB = document.querySelector('input[placeholder*="satuan kg" i]') || document.querySelector('input[placeholder*="Berat Badan" i]') || realInputs[0];
        const inputTB = document.querySelector('input[placeholder*="tinggi badan" i]') || realInputs[1];
        const inputLP = realInputs.find(el => (el.placeholder || '').toLowerCase().includes('hasil pengukuran') && !(el.placeholder || '').toLowerCase().includes('tinggi badan')) || realInputs[2];
        
        if (inputBB) forceInject(inputBB, data.bb); await sleep(800);
        if (inputTB) forceInject(inputTB, data.tb); await sleep(800);
        if (inputLP) forceInject(inputLP, data.lp); await sleep(1000);
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
    
    // [UPDATE DINAMIS] Menarik Data Frambusia, Kusta, Skabies
    else if(title.includes('frambusia')){
        currentId = 'frambusia'; updateStatus('MENGISI TAHAP: FRAMBUSIA');
        await pilihSemuaRadioLimit(data.frambusia, 99, false);
        await selectDropdownSurveyJS(data.frambusia);
    }
    else if(title.includes('kusta')){
        currentId = 'kusta'; updateStatus('MENGISI TAHAP: KUSTA');
        await selectDropdownSurveyJS(data.kusta);
    }
    else if(title.includes('skabies')){
        currentId = 'skabies'; updateStatus('MENGISI TAHAP: SKABIES');
        await selectDropdownSurveyJS(data.skabies);
    }
    
    // [UPDATE DINAMIS] Menarik Data Gigi Anak
    else if(title.includes('pemeriksaan gigi')){
        currentId = 'gigi'; updateStatus('MENGISI TAHAP: GIGI ANAK');
        await pilihSemuaRadioLimit(data.gigi, 99, false);
        await selectDropdownSurveyJS(data.gigi, 1);
    }
    
    // [UPDATE DINAMIS] Menarik Data Kebugaran (IMT logic dihapus, menggunakan kolom CR)
    else if(title.includes('kebugaran jasmani')){
        currentId = 'jasmani'; updateStatus('MENGISI TAHAP: KEBUGARAN JASMANI');
        await isiDropdownSurveyJS('kebugaran jasmani', data.kebugaran);
        await sleep(800);
    }
    
    // [UPDATE DINAMIS] Menarik Data Merokok
    else if(title.includes('merokok')){
        currentId = 'merokok'; updateStatus('MENGISI TAHAP: MEROKOK');
        await pilihSemuaRadioLimit(data.merokok, 99, false);
        await selectDropdownSurveyJS(data.merokok);
        await sleep(800);
    }
    
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
        <div id="drag-handle">INPUT CKG BALITA ANAK & REMAJA </div>
        <div id="bot-status">Menyiapkan Database, Klik Start !... </div>
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
