(function (GM_xmlhttpRequest) {
'use strict';
    const request = GM_xmlhttpRequest;

/* =========================================================
   CONFIG SPREADSHEET
========================================================= */
const SHEET_ID = '1gmDrmxOU2Lle7vhoXo-o8DgOp6rbNK1P';
const GIDS = ['1744259778'];

const sleep = ms => new Promise(r => setTimeout(r,ms));
function normalizeNIK(v) { return String(v || '').replace(/\D/g,''); }

/* =========================================================
   HELPER MAPPING JAWABAN MEROKOK
========================================================= */
function jawabanMerokok(v){
    const text = String(v || '').toLowerCase().trim();
    return (
        text.includes('ya') ||
        text.includes('rokok') ||
        text.includes('perokok')
    ) ? 'ya' : 'tidak';
}

/* =========================================================
   SESSION & DYNAMIC TRACKER
========================================================= */
function saveBOT(data) { GM_setValue('AUTO_SKRINING_DATA', JSON.stringify(data)); }
function loadBOT()     { const raw = GM_getValue('AUTO_SKRINING_DATA'); return raw ? JSON.parse(raw) : null; }
function clearBOT() { GM_deleteValue('AUTO_SKRINING_DATA'); GM_deleteValue('CKG_MODE'); }

function getCompleted() { return JSON.parse(GM_getValue('AUTO_SKRINING_COMPLETED') || '[]'); }
function addCompleted(id) {
    const arr = getCompleted();
    if(!arr.includes(id)) arr.push(id);
    GM_setValue('AUTO_SKRINING_COMPLETED', JSON.stringify(arr));
}
function clearCompleted() { GM_deleteValue('AUTO_SKRINING_COMPLETED'); }

/* =========================================================
   DATA MATCHER (ANTI ERROR / FORMAT AMAN)
========================================================= */
function parseCSV(text) {
    // PROTEKSI: Jika teks kosong atau gagal load, kembalikan array kosong
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

// ========================================================
// 1. TAMBAHKAN HELPER INDEXEDDB DI LUAR FUNGSI UTAMA
// ========================================================
const DB_NAME = 'CKG_Database';
const STORE_NAME = 'SheetCache';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            e.target.result.createObjectStore(STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function setCacheDB(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
    });
}

async function getCacheDB(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(tx.error);
    });
}

// ========================================================
// 2. KODE FUNGSI CARI DATA YANG SUDAH DIOPTIMASI & DIGABUNG
// ========================================================
async function cariData(nikInput) {
    try {
        const target = normalizeNIK(nikInput);
        
        // --- TAHAP 1: SIAPKAN DATA (DARI RAM, INDEXEDDB, ATAU DOWNLOAD) ---
        if (!cachedSheetData || cachedSheetData.length === 0) {
            
            let savedCache = null;
            let cacheTime = 0;
            const EXPIRATION_TIME = 4 * 60 * 60 * 1000; // Cache bertahan 4 jam
            const now = Date.now();

            // Cek IndexedDB
            try {
                savedCache = await getCacheDB('CKG_SHEET_DATA');
                cacheTime = await getCacheDB('CKG_SHEET_TIME') || 0;
            } catch(e) {
                console.warn("Gagal membaca IndexedDB", e);
            }

            // Gunakan Cache jika valid
            if (savedCache && savedCache.length > 0 && (now - cacheTime < EXPIRATION_TIME)) {
                console.log('[CACHE READY] Memuat data dari IndexedDB (Cepat)...');
                cachedSheetData = savedCache;
            } 
            // Download jika tidak ada/expired
            else {
                updateStatus("MENGUNDUH DATA SPREADSHEET...");
                cachedSheetData = [];

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
                            cachedSheetData = rows;
                        } else {
                            for (let i = 1; i < rows.length; i++) {
                                cachedSheetData.push(rows[i]);
                            }
                        }
                    }
                }
                
                console.log('[DOWNLOAD SELESAI]', cachedSheetData.length, 'baris didapat.');

                // Simpan ke IndexedDB
                try {
                    await setCacheDB('CKG_SHEET_DATA', cachedSheetData);
                    await setCacheDB('CKG_SHEET_TIME', now);
                    console.log('[CACHE SAVED] Data berhasil disimpan ke IndexedDB.');
                } catch(e) {
                    console.warn("Gagal menyimpan ke IndexedDB, data hanya di RAM sementara.", e);
                }
            }
        }
        
        // --- TAHAP 2: PROSES PENCARIAN NIK ---
        
        // PROTEKSI: Pastikan array cachedSheetData valid dan punya data selain header
        if (!cachedSheetData || cachedSheetData.length < 2) {
            console.warn("Data sheet kosong atau gagal dimuat.");
            return null;
        }

        // Loop pencarian menggunakan cachedSheetData
        for (let i = 1; i < cachedSheetData.length; i++) {
            const row = cachedSheetData[i];

            // PROTEKSI: Jika ada baris "sampah" atau kolom tidak cukup panjang
            if (!row || row.length < 12) continue;

            const nikSheet = normalizeNIK(row[11]);

            if (nikSheet === target) {
                // --- DEBUGGER: Menampilkan data mentah ke Console ---
                console.log("=== DEBUG DATA PADA BARIS INI ===");
                console.log("Target NIK:", target);
                console.log("Panjang array baris (total kolom):", row.length);
                console.log("Isi Kolom 72 (Jiwa 1):", row[72]);
                console.log("Isi Kolom 73 (Jiwa 2):", row[73]);
                console.log("Isi Kolom 74 (Jiwa 3):", row[74]);
                console.log("Isi Kolom 75 (Jiwa 4):", row[75]);
                console.log("================================");
                
                return {
                    nik: target,
                    perkawinan: row[26] || 'Belum Menikah',
                    merokok: (row[85] || 'Tidak').trim(),
                    jiwa1: (row[72] || 'Tidak sama sekali').trim(),
                    jiwa2: (row[73] || 'Tidak sama sekali').trim(),
                    jiwa3: (row[74] || 'Tidak sama sekali').trim(),
                    jiwa4: (row[75] || 'Tidak sama sekali').trim()  
                };
            }
        }
        
        // Jika looping selesai tapi NIK tidak ditemukan
        return null;

    } catch (error) { 
        console.error("Terjadi kesalahan saat mencari data:", error);
        return null;
    }
}
    
/* =========================================================
   DOM INTERACTOR (SURVEYJS SAFE & ADVANCED)
========================================================= */
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
    } catch(e) {
        console.error("Error mengisi radio:", e);
    }
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
        await sleep(850);

        const search = document.querySelector('input[type="text"][role="combobox"], input[aria-expanded="true"]');
        if (search && typeChar) {
            search.focus();
            search.value = typeChar;
            search.dispatchEvent(new Event('input', { bubbles: true }));
            search.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(850);
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
    } catch (e) { console.error('Error selectDropdownContext:', e); }
    return false;
}

async function isiKesehatanJiwa() {

    const semuaPertanyaan = [
        ...document.querySelectorAll('.sd-question, .sd-element')
    ];

    for (const q of semuaPertanyaan) {

        const text = (q.innerText || '').toLowerCase();

        if (
            text.includes('2 minggu terakhir') ||
            text.includes('kurang/tidak bersemangat') ||
            text.includes('merasa murung') ||
            text.includes('cemas') ||
            text.includes('gelisah')
        ) {

            const pilihan = [
                ...q.querySelectorAll('.sd-item, .sv-item')
            ];

            const tidakSamaSekali = pilihan.find(el =>
                (el.innerText || '')
                    .toLowerCase()
                    .includes('tidak sama sekali')
            );

            if (tidakSamaSekali) {

                const radio =
                    tidakSamaSekali.querySelector('.sd-radio__decorator') ||
                    tidakSamaSekali.querySelector('.sd-item__decorator');

                if (radio) {
                    radio.click();
                    await sleep(300);
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
    await sleep(850);

    const btnKirim = document.querySelector('.sd-navigation__complete-btn') || [...document.querySelectorAll('button,input[type="button"]')].find(el => (el.value || el.innerText || '').toLowerCase().includes('kirim'));
    if (btnKirim) {
        btnKirim.click();
        await sleep(3000);
    }
    return true;
}

async function isiImunisasiBalita() {
    const judul = document.body.innerText.toLowerCase();
    if (!judul.includes('riwayat imunisasi rutin balita')) return false;

    updateStatus('Mengisi Imunisasi Balita Berantai...');

    let jumlahSoalTerjawab = 0;
    let maksimalLoop = 0;

    while (maksimalLoop < 20) {
        maksimalLoop++;

        const semuaSoal = [...document.querySelectorAll('.sd-question, .sv-question, .sd-element')]
            .filter(q => q.offsetParent !== null); 

        if (semuaSoal.length === 0 || semuaSoal.length === jumlahSoalTerjawab) {
            break; 
        }

        for (let i = jumlahSoalTerjawab; i < semuaSoal.length; i++) {
            const soalSaatIni = semuaSoal[i];
            
            soalSaatIni.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(500);

            const dropdown = soalSaatIni.querySelector('.sd-dropdown, .sv-dropdown, [role="combobox"]');
            
            if (dropdown) {
                const teksKotak = (dropdown.innerText || dropdown.value || '').toLowerCase().trim();
                
                // Jika sudah terpilih positif (Ya, Pernah, Sudah), lewati
                if (teksKotak === 'ya' || teksKotak === 'sudah' || teksKotak.includes('pernah') || (teksKotak.includes('ya') && !teksKotak.includes('tidak'))) {
                    continue;
                }

                // 1. KLIK BUKA MENU
                triggerClick(dropdown); 
                await sleep(850); 

                // 2. CEK APAKAH INPUT KOTAK BISA DIKETIK ATAU READONLY
                const searchInput = soalSaatIni.querySelector('input.sd-dropdown__filter-string-input, input[role="combobox"]');
                const isReadOnly = searchInput ? (searchInput.readOnly || searchInput.hasAttribute('readonly')) : true;

                // 3. JALUR HYBRID: Ketik otomatis jika tidak readonly
                if (!isReadOnly && searchInput) {
                    searchInput.focus();
                    forceInject(searchInput, 'Pernah');
                    await sleep(500);
                    searchInput.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 13, bubbles: true }));
                    await sleep(500);
                }

                // 4. CARI DI POPUP MELAYANG (Mendukung 'Pernah', 'Ya', 'Sudah')
                const elemenOpsi = [...document.querySelectorAll('.sv-list__item, .sd-list__item, li[role="option"]')]
                    .filter(el => {
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0; 
                    });

                const targetOpsi = elemenOpsi.find(el => {
                    const txt = (el.innerText || el.textContent || '').toLowerCase().trim();
                    return txt === 'ya' || txt === 'sudah' || txt.includes('pernah') || (txt.includes('ya') && !txt.includes('tidak'));
                });

                if (targetOpsi) {
                    triggerClick(targetOpsi);
                    await sleep(800);
                } else {
                    if (isReadOnly) {
                        triggerClick(dropdown); // Tutup kembali jika opsi tidak ditemukan
                    }
                    await sleep(500);
                }
            } 
            else {
                // JIKA BENTUKNYA RADIO BUTTON
                const radioItems = [...soalSaatIni.querySelectorAll('.sd-item, .sv-item')];
                for (const item of radioItems) {
                    const txt = (item.innerText || '').toLowerCase().trim();
                    if (txt === 'ya' || txt === 'sudah' || txt.includes('pernah') || (txt.includes('ya') && !txt.includes('tidak'))) {
                        const decorator = item.querySelector('.sd-radio__decorator, .sd-item__decorator') || item;
                        triggerClick(decorator);
                        break;
                    }
                }
            }

            await sleep(850); 
        }
        jumlahSoalTerjawab = semuaSoal.length;
    }

    await sleep(850);
    const btnKirim = document.querySelector('.sd-navigation__complete-btn') || 
                     [...document.querySelectorAll('button,input[type="button"]')].find(b => (b.innerText||'').toLowerCase().match(/lanjut|kirim/));

    if (btnKirim) {
        triggerClick(btnKirim);
        await sleep(1500);
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
        await sleep(850); 

        if (data.perkawinan && data.perkawinan !== 'Data Kosong') {
            let p = data.perkawinan.toLowerCase();
            let target = 'Menikah'; 
            if (p.includes('belum')) target = 'Belum Menikah';
            else if (p.includes('janda') || p.includes('duda') || p.includes('cerai')) target = 'Cerai Hidup'; 
            
            updateStatus('Mengisi: ' + target);
            await fillRadioSurveyJS('status perkawinan', target);
            await sleep(850);
        } else {
            updateStatus('Data Perkawinan Kosong!');
            await sleep(850);
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

    // KESEHATAN JIWA (Advance)
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
        const semuaPertanyaan = [...document.querySelectorAll('.sd-question, .sd-element')];
        
        for (const q of semuaPertanyaan) {
            const text = (q.innerText || '').toLowerCase();
            let targetJawaban = '';

            if (text.includes('setahun terakhir')) targetJawaban = statusMerokok;
            else if (text.includes('15 tahun terakhir')) targetJawaban = statusMerokok;
            else if (text.includes('menghirup asap rokok') || text.includes('terpapar asap rokok')) targetJawaban = statusMerokok;
            else if (text.includes('jenis rokok apa yang dikonsumsi')) targetJawaban = 'konvensional';
            else if (text.includes('kanker paru pada keluarga') || text.includes('batuk dalam jangka waktu') || text.includes('tbc atau ppok')) targetJawaban = 'tidak';

            if (targetJawaban !== '') {
                const pilihan = [...q.querySelectorAll('.sd-item, .sv-item')];
                const targetPilihan = pilihan.find(el => (el.innerText || '').toLowerCase().includes(targetJawaban));
                
                if (targetPilihan) {
                    const radio = targetPilihan.querySelector('.sd-radio__decorator') || targetPilihan.querySelector('.sd-item__decorator') || targetPilihan.querySelector('input[type="radio"]');
                    if (radio) {
                        radio.click();
                        const inputAsli = targetPilihan.querySelector('input[type="radio"]');
                        if (inputAsli) {
                            inputAsli.checked = true;
                            inputAsli.dispatchEvent(new Event('input', { bubbles:true }));
                            inputAsli.dispatchEvent(new Event('change', { bubbles:true }));
                        }
                        await sleep(300); 
                    }
                }
            }
        }
    }

    // 5. SAPU BERSIH (Isi radio kosong menjadi default)
    const questions = document.querySelectorAll('.sd-question, .sv-question, .sd-element, [data-name]');
    questions.forEach(q => {
        let isAnswered = false;
        const radios = q.querySelectorAll('input[type="radio"]');
        if (radios.length === 0) return;

        radios.forEach(radio => { if (radio.checked) isAnswered = true; });
        if (isAnswered) return;

        let qText = (q.innerText||'').toLowerCase();
        if (qText.includes('berapa hari anda aktif secara fisik') || qText.includes('jumlah hari aktif')) return; 

        q.querySelectorAll('label').forEach(l => {
            let txt = (l.innerText||'').toLowerCase().trim();
            if (txt === 'tidak' || txt === 'normal' || txt === 'tidak ada') {
                let i = l.querySelector('input[type="radio"]');
                if (i && !i.checked) { 
                    const decorator = l.querySelector('.sd-radio__decorator, .sd-item__decorator') || l;
                    decorator.click(); 
                    i.checked = true; 
                    i.dispatchEvent(new Event('input', { bubbles:true }));
                    i.dispatchEvent(new Event('change', { bubbles:true }));
                }
            }
        });
    });

    // 6. AKTIVITAS FISIK (Support Injection Angka Advance)
    if (pageText.includes('aktivitas fisik')) {
        updateStatus('Mengisi Aktivitas Fisik...');
        
        const inputAngka = [...document.querySelectorAll('input[type="number"]')];
        if (inputAngka.length > 0) {
            if (inputAngka[0]) forceInject(inputAngka[0], '3');
            await sleep(500);
            if (inputAngka[1]) forceInject(inputAngka[1], '3');
            await sleep(500);
        }

        const dropdowns = [...document.querySelectorAll('.sd-dropdown, .sv-dropdown')];
        for (let i = 0; i < dropdowns.length; i++) {
            const currentDropdown = dropdowns[i];
            if (!currentDropdown) continue;
            currentDropdown.scrollIntoView({ behavior: 'smooth', block: 'center' });
            currentDropdown.click();
            await sleep(1200);

            const opsiTidak = [...document.querySelectorAll('li.sv-list__item, li.sd-list__item')].filter(li => li.innerText.trim().toLowerCase() === 'tidak');
            if (opsiTidak[i]) {
                opsiTidak[i].click();
                opsiTidak[i].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                await sleep(500);
            } else { break; }
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
   FORM LOOP ROUTER (FIXED)
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
            // DEFENSIVE CHECK: Tunggu sampai kerangka soal SurveyJS benar-benar muncul di layar
            const formReady = document.querySelector('.sd-question, .sv-question, .sd-element');
            
            if (!formReady) {
                updateStatus('Menunggu form dimuat...');
                await sleep(1500);
                continue; // Jangan lanjut ke bawah, putar ulang loop sampai form muncul
            }

            // Setelah form dipastikan muncul, baru kita baca teks halamannya
            const pageText = document.body.innerText.toLowerCase();

            if (pageText.includes('riwayat imunisasi rutin balita')) {
                // Eksekusi Imunisasi Balita hardcode Ya/Sudah
                await isiImunisasiBalita();
            } else if (pageText.includes('riwayat imunisasi tetanus')) {
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
   DASHBOARD TRACKER (FITUR UTAMA CKG)
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
            // Buat ID unik berdasarkan teks di baris tabel/kotak tersebut
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

    // Pastikan loop hanya jalan jika BOT_RUNNING = true
    while (BOT_RUNNING && location.hostname.includes('sehatindonesiaku')) {
        
        // GUNAKAN 'let' supaya nilainya bisa diupdate di dalam loop
        let nextItem = null;

        // --- RE-TRY LOGIC ---
        // Mencoba mencari tombol hingga 3 kali
        for (let i = 0; i < 3; i++) {
            nextItem = getNextTarget(); // Sekarang aman karena let
            if (nextItem) break; 
            
            console.log("Tombol belum muncul, mencoba lagi (percobaan " + (i+1) + ")...");
            await sleep(2000);
        }

        // Jika setelah 3 kali tetap tidak ketemu
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
        
        // Klik tombol
        nextItem.btn.click();
        
        // Tunggu form muncul
        await sleep(5000); 
    }
}

/* =========================================================
   UI MODERN & DRAGGABLE (CIJERAH)
========================================================= */
let LOOP_ACTIVE = false; 
    
function updateStatus(text){ const el = document.getElementById('bot-status'); if(el) el.innerText = text; }
function stopBOT(){ BOT_RUNNING = false; LOOP_ACTIVE = false; clearBOT(); clearCompleted(); updateStatus('BOT DIHENTIKAN & NIK DIHAPUS.'); }

function createUI(){
    if(document.getElementById('auto-ckg-ui')) return;
    const box = document.createElement('div'); box.id = 'auto-ckg-ui';
    box.innerHTML = `
        <div id="drag-handle">SKRINING MANDIRI CIJERAH</div>
        <div id="bot-status">INISIALISASI...</div>
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
        if(BOT_RUNNING || LOOP_ACTIVE) return alert('BOT SEDANG BERJALAN');
        const nik = document.getElementById('nik-bot').value;
        if(!nik) return alert('Masukkan NIK');

        updateStatus('MENCARI NIK DI SPREADSHEET...');
        const data = await cariData(nik);

        if(!data) return updateStatus('NIK TIDAK DITEMUKAN DI GOOGLE SHEETS');

        // Simpan data dan reset antrian
        saveBOT(data);
        clearCompleted(); 

        updateStatus(`Data Ketemu!\nMemulai Otomatis...`);
        
        // Aktifkan bot. Sistem Supervisor akan otomatis mengambil alih ke menu yang tepat.
        BOT_RUNNING = true;
    };
    
    document.getElementById('stop-bot').onclick = stopBOT;
}

/* =========================================================
   INIT / SUPERVISOR OBSERVER (ANTI MACET SPA)
========================================================= */
// 1. Amankan UI agar selalu muncul
setInterval(createUI, 1000);

let isDownloadingBackground = false;

// 2. Supervisor Loop (Berjalan setiap 2 detik memantau URL tanpa henti)
setInterval(async () => {
    const isFormPage = location.hostname.includes('form.kemkes.go.id');
    const isMainPage = location.hostname.includes('sehatindonesiaku');
    
    const data = loadBOT();

    // Auto-Resume: Jika web di-refresh manual oleh user tapi pasien belum selesai
    if (data && !BOT_RUNNING) {
        BOT_RUNNING = true;
    }

    // Download Database secara tersembunyi (Hanya saat bot nganggur di Dashboard)
    if (isMainPage && !data && !cachedSheetData && !isDownloadingBackground) {
        isDownloadingBackground = true;
        cariData('000').then(() => {
            if (!BOT_RUNNING) updateStatus('Database Siap !\nklik START');
        }).catch(e => {
            isDownloadingBackground = false; // Boleh coba lagi jika gagal
        });
    }

    // LOGIK INTI (Mencegah bot diam saat URL berubah)
    if (BOT_RUNNING && data && !LOOP_ACTIVE) {
        if (isFormPage) {
            LOOP_ACTIVE = true; // Kunci agar tidak bentrok
            await autoContinueForm();
            LOOP_ACTIVE = false; // Buka kunci saat loop selesai/pindah URL
        } 
        else if (isMainPage) {
            LOOP_ACTIVE = true;
            await mainLoop(data);
            LOOP_ACTIVE = false;
        }
    }
}, 2000);

})(typeof GM_xmlhttpRequest !== "undefined" ? GM_xmlhttpRequest : null);
