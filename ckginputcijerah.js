(function () {
'use strict';

/* =========================================================
   CONFIG
========================================================= */
const SHEET_ID = '17zbvari4OsXTKScnLnlr7x503jHIqBbT';
const GID = '264423006';
   
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
    { id: 'puma', txt: 'puma' }, 
    { id: 'kanker_paru', txt: 'skrining kanker paru' },
    { id: 'skilas_kog', txt: 'penurunan kognitif' },
    { id: 'skilas_mob', txt: 'mobilisasi' },
    { id: 'skilas_mob_alt', txt: 'tingkat kemandirian' },
    { id: 'skilas_mal', txt: 'malnutrisi' },
    { id: 'skilas_dep', txt: 'depresi' },
    { id: 'skilas_dep_alt', txt: 'emosional' }
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
   DATA MATCHER (OPTIMASI DENGAN CACHE)
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
        
        // --- TAHAP 1: CEK CACHE ATAU DOWNLOAD (ANTI CRASH) ---
        if (!cachedSheetData || cachedSheetData.length === 0) {
            
            let savedCache = null;
            let cacheTime = 0;
            const EXPIRATION_TIME = 4 * 60 * 60 * 1000; // Cache 4 jam
            const now = Date.now();

            // 1. Cek dari IndexedDB
            try {
                savedCache = await getCacheDB('CKG_SHEET_DATA');
                cacheTime = await getCacheDB('CKG_SHEET_TIME') || 0;
            } catch(e) {
                console.warn("Gagal membaca IndexedDB", e);
            }

            // 2. Jika valid, gunakan dari IndexedDB (Langsung load ke RAM tanpa nge-lag)
            if (savedCache && savedCache.length > 0 && (now - cacheTime < EXPIRATION_TIME)) {
                console.log('[CACHE READY] Memuat data dari IndexedDB...');
                cachedSheetData = savedCache;
            } 
            // 3. Jika tidak ada / expired, lakukan Download
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
                        // [OPTIMASI MEMORI] Ganti .concat() dengan PUSH LOOP
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

                // Simpan ke IndexedDB secara background
                try {
                    await setCacheDB('CKG_SHEET_DATA', cachedSheetData);
                    await setCacheDB('CKG_SHEET_TIME', now);
                    console.log('[INFO] Database besar berhasil disimpan ke IndexedDB agar aman dari limit RAM.');
                } catch(e) {
                    console.warn("Gagal menyimpan ke IndexedDB.", e);
                }
            }
        }

        // --- TAHAP 2: PROSES PENCARIAN NIK ---
        const rows = cachedSheetData;
        
        // Proteksi jika data gagal diload
        if (!rows || rows.length < 2) return null;
        
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            
            // Proteksi baris pendek / kosong
            if (!row || row.length < 10) continue; 
            
            const cells = row.map(col => String(col || '').trim());
            const rawNik = (cells.length > 2) ? (cells[0] || cells[1] || cells[2]) : '';
            
            if (normalizeNIK(rawNik) === target || cells.some(col => normalizeNIK(col) === target)) {
                
                // Jika ketemu, return format data yang Anda inginkan
                return {
                    nik: target,
                    nama: cells[5] || '',
                    sistole: cells[26] || '',
                    diastole: cells[27] || '',
                    bb: cells[29] || '',
                    tb: cells[30] || '',
                    lp: cells[32] || '',
                    gula: cells[38] || '',
                    mata: cells[84] || 'Tidak',
                    skilasKog3: (cells[41] || 'Ya').trim(),
                    skilasMob:  (cells[42] || 'Ya').trim(),
                    skilasMal1: (cells[43] || 'Tidak').trim(),
                    skilasMal2: (cells[44] || 'Tidak').trim(),
                    skilasMal3: (cells[45] || 'Tidak').trim(),
                    skilasDep1: (cells[46] || 'Tidak').trim(),
                    skilasDep2: (cells[47] || 'Tidak').trim()
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

async function selectDropdownContext(soalText, optionText) {
    // 1. Cari kontainer soal berdasarkan teks
    const questions = [...document.querySelectorAll('.sd-question, .sv-question, .sd-element')];
    const targetQ = questions.find(q => (q.innerText || '').toLowerCase().includes(soalText.toLowerCase()));
    if (!targetQ) return false;

    // 2. Cari dropdown di dalam soal tersebut
    const dropdown = targetQ.querySelector('.sd-dropdown');
    if (!dropdown) return false;

    // 3. Klik untuk membuka
    dropdown.click();
    await sleep(1000); // Wajib tunggu animasi

    // 4. KUNCI: Cari daftar pilihan BERDASARKAN ID (aria-controls)
    const listId = dropdown.getAttribute('aria-controls');
    const listElement = document.getElementById(listId);
    
    if (!listElement) {
        console.warn('Daftar pilihan tidak ditemukan untuk:', soalText);
        dropdown.click(); // Tutup kembali
        return false;
    }

    // 5. Cari opsi HANYA di dalam listElement tersebut
    const options = [...listElement.querySelectorAll('.sv-list__item-body')];
    const targetOpt = options.find(el => 
        (el.innerText || '').trim().toLowerCase() === optionText.toLowerCase()
    );

    if (targetOpt) {
        targetOpt.click();
        await sleep(500);
        console.log('[AI] Berhasil memilih:', optionText);
        return true;
    } else {
        console.warn('Opsi tidak ditemukan di list:', optionText);
        dropdown.click(); // Tutup kembali jika gagal
        return false;
    }
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
      
        // PROTEKSI INFINITE LOOP: Jika opsi "Normal/Tidak" tidak ada di soal tersebut
        if (!foundDefaultAnswer) {
            console.warn("[WARNING] Soal wajib kosong tapi tidak ada opsi default (Normal/Tidak).");
            updateStatus('Terjebak soal wajib.\nSilakan isi manual lalu klik Kirim.');
            return false; // Hentikan loop paksa
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
   FORM FILLER LOGIC
========================================================= */
async function autoContinueForm(){
    const data = loadBOT();
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
       else if(title.includes('skrining kanker paru') && (title.includes('riwayat merokok') || title.includes('skrining kanker paru'))) {
        currentId = 'kanker_paru'; 
        updateStatus('MENGISI TAHAP: KANKER PARU');
        await sleep(2000);

        let isPerokok = (data.merokok || '').toLowerCase().includes('ya') || 
                        (data.merokok || '').toLowerCase().includes('rokok');

        // 1 & 2. Pilih yang ada teks Tidak
        await isiRadioSurveyJS('didiagnosis atau menderita kanker', 'tidak pernah didiagnosis');
        await isiRadioSurveyJS('ada anggota keluarga yang menderita kanker', 'tidak ada keluarga');

        // 3. Riwayat merokok/paparan asap
        if (isPerokok) {
            await isiRadioSurveyJS('riwayat merokok', 'perokok aktif');
        } else {
            await isiRadioSurveyJS('riwayat merokok', 'tidak pernah merokok');
        }

        // 4. Tempat kerja zat karsinogenik
        await isiRadioSurveyJS('zat karsinogenik', 'Tidak tempat kerja mengandung zat karsinogenik');

        // 5. Berpotensi tinggi
        await isiRadioSurveyJS('berpotensi tinggi', 'Tidak memiliki tempat tinggal berpotensi tinggi');

        // 6. Rumah tidak sehat (Khusus ini teksnya "memiliki lingkungan dalam rumah yang sehat")
        await isiRadioSurveyJS('dalam rumah yang tidak sehat', 'Memiliki lingkungan dalam rumah yang sehat');

        // 7. Paru kronik
        await isiRadioSurveyJS('penyakit paru kronik', 'tidak pernah didiagnosis penyakit paru kronik');

        // 8. Foto Torax akan diabaikan (Jangan diisi apa-apa)
        await sleep(500);
    }
   else if(title.includes('puma') || title.includes('ppok')){
        currentId = 'puma'; updateStatus('MENGISI TAHAP: PPOK (PUMA)');

        // Mengecek apakah data merokok mengandung kata 'ya' atau 'rokok'
        let isPerokok = (data.merokok || '').toLowerCase().includes('ya') || 
                        (data.merokok || '').toLowerCase().includes('rokok');

        // 1. Riwayat merokok (Pilih 'Iya' atau 'Tidak')
        await isiRadioSurveyJS('mempunyai riwayat merokok', isPerokok ? 'iya' : 'tidak');
        await sleep(400);

        // 2-5. Jawab otomatis Tidak
        await isiRadioSurveyJS('napas pendek', 'tidak');
        await isiRadioSurveyJS('mempunyai dahak', 'tidak');
        await isiRadioSurveyJS('batuk saat sedang tidak menderita', 'tidak');
        await isiRadioSurveyJS('spirometri', 'tidak');
        await sleep(500);
    }
      else if (title.includes('penurunan kognitif')) {
        currentId = 'skilas_kog'; updateStatus('MENGISI TAHAP: PENURUNAN KOGNITIF');
        await isiRadioSurveyJS('mengingat tiga kata: bunga', data.skilasKog1);
        let opsiKog2 = (data.skilasKog2 || '').toLowerCase().includes('ya') ? 'benar semua' : 'salah';
        await isiRadioSurveyJS('tanggal berapakah hari ini', opsiKog2);
        await isiRadioSurveyJS('mengingat tiga kata sebelumnya', data.skilasKog3);
    }
    else if (title.includes('mobilisasi') || title.includes('tingkat kemandirian')) {
        currentId = 'skilas_mob'; updateStatus('MENGISI TAHAP: MOBILISASI');
        await isiRadioSurveyJS('berdiri dari kursi lima kali', data.skilasMob);
    }
    else if (title.includes('malnutrisi')) {
        currentId = 'skilas_mal'; updateStatus('MENGISI TAHAP: MALNUTRISI');
        await isiRadioSurveyJS('berat badan anda berkurang', data.skilasMal1);
        await isiRadioSurveyJS('hilang nafsu makan', data.skilasMal2);
        await isiRadioSurveyJS('ukuran lingkar lengan atas', data.skilasMal3);
    }
    else if (title.includes('gejala depresi') || title.includes('emosional')) {
        currentId = 'skilas_dep'; 
        updateStatus('MENGISI TAHAP: DEPRESI');
        
        // Ambil data (pastikan isinya "Ya" atau "Tidak" sesuai yang ada di website)
        let d1 = (data.skilasDep1 || 'tidak').trim();
        let d2 = (data.skilasDep2 || 'tidak').trim();
        
        // Panggil fungsi yang sudah diperbaiki
        await selectDropdownContext('merasa sedih, tertekan', d1);
        await sleep(500);
        await selectDropdownContext('sedikit minat atau kesenangan', d2);
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
    updateStatus('MENCARI ANTRIAN...');
    await sleep(2000); // Beri waktu halaman bernapas
    
    let nextItem = getNextTarget();
    
    // --- TAMBAHAN: RE-TRY LOGIC ---
    // Jika tombol tidak ketemu, coba tunggu sekali lagi (mungkin halaman masih loading)
    if(!nextItem) {
        console.warn("Tombol tidak ketemu, mencoba scan ulang dalam 2 detik...");
        await sleep(2000);
        nextItem = getNextTarget();
    }
    // ------------------------------

    if(!nextItem){
        clearBOT(); clearCompleted(); BOT_RUNNING = false;
        updateStatus('SELESAI SEMUA PEMERIKSAAN'); 
        alert('BOT SUKSES INPUT SEMUA PEMERIKSAAN');
        return;
    }
    
    updateStatus('MEMBUKA TARGET:\n' + nextItem.title.toUpperCase());
    await sleep(1000);
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
