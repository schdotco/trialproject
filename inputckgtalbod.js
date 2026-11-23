(function (GM_xmlhttpRequest) {
'use strict';
    const request = typeof GM_xmlhttpRequest !== "undefined" ? GM_xmlhttpRequest : null;

/* =========================================================
   [EXPERT FEATURE] 1. SISTEM TELEMETRI & ERROR LOGGING
========================================================= */
function sendBotErrorLog(context, errorMessage) {
    try {
        const deviceId = localStorage.getItem("CKG_DEVICE_ID") || "Unknown_Device";
        const payload = {
            fields: {
                timestamp: { stringValue: new Date().toISOString() },
                device: { stringValue: deviceId },
                module: { stringValue: "INPUT_DEWASA_BOT_SMART" },
                context: { stringValue: context },
                message: { stringValue: String(errorMessage) }
            }
        };
        if (request) {
            request({
                method: "POST",
                url: "https://firestore.googleapis.com/v1/projects/jadwal-daily-pkm-padasuka/databases/(default)/documents/Customer/Talbod/error_logs",
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify(payload)
            });
        }
    } catch(e) { /* Fallback diam agar tidak mengganggu UI */ }
}

/* =========================================================
   [EXPERT FEATURE] 2. TOAST NOTIFICATION (NON-BLOCKING UI)
========================================================= */
function showToast(message, type = 'info') {
    if (!document.body) return;
    const toastId = 'ckg-toast-container';
    let container = document.getElementById(toastId);
    if (!container) {
        container = document.createElement('div');
        container.id = toastId;
        container.style = "position:fixed; top:20px; right:20px; z-index:999999; display:flex; flex-direction:column; gap:10px; pointer-events:none;";
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    const bgColors = { info: '#3b82f6', success: '#10b981', error: '#ef4444', warning: '#f59e0b' };
    toast.style = `background:${bgColors[type] || bgColors.info}; color:#fff; padding:12px 20px; border-radius:8px; box-shadow:0 4px 15px rgba(0,0,0,0.3); font-family:sans-serif; font-size:14px; font-weight:bold; opacity:0; transform:translateX(50px); transition:all 0.3s ease;`;
    toast.innerHTML = message;
    
    container.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(0)'; });
    
    setTimeout(() => {
        toast.style.opacity = '0'; toast.style.transform = 'translateX(50px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

/* =========================================================
   MODUL ESTAFET, AUDIO & HUMANIZED DELAY
========================================================= */
function randomJeda(min, max) { 
    if(!max) max = min + 300; 
    return new Promise(r => setTimeout(r, Math.random() * (max - min) + min)); 
}

function playSound(type) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        if (type === 'sukses') { 
            osc.type = 'sine'; osc.frequency.setValueAtTime(880, ctx.currentTime);
            gain.gain.setValueAtTime(0.5, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
            osc.start(); osc.stop(ctx.currentTime + 0.5);
        } else if (type === 'selesai') { 
            osc.type = 'triangle'; osc.frequency.setValueAtTime(523.25, ctx.currentTime); 
            osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.2); 
            osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.4); 
            gain.gain.setValueAtTime(0.5, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1);
            osc.start(); osc.stop(ctx.currentTime + 1);
        }
    } catch(e) {}
}

/* =========================================================
   CONFIG - TARGETS DEWASA & LANSIA
========================================================= */
const SHEET_ID = '1oj8ES4u6L6odKIy2639u9EtG2OwYr5vvQFaY3YH4dXQ';
const GIDS = ['0'];
let BOT_RUNNING = false;

const TARGETS = [
    { id: 'gizi', txt: 'gizi' },
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

// Hitung umur hanya selisih tahun & mendeteksi angka tahun dengan pintar
function hitungUmur(tglLahirStr) {
    if (!tglLahirStr) return 0;
    try {
        let match = String(tglLahirStr).match(/(19\d{2}|20\d{2})/);
        if (match && match[1]) {
            let tahunLahir = parseInt(match[1]);
            let tahunSekarang = new Date().getFullYear();
            return tahunSekarang - tahunLahir;
        }
        return 0;
    } catch(e) {
        return 0;
    }
}

/* =========================================================
   SESSION & DYNAMIC TRACKER
========================================================= */
const WAKTU_KEDALUWARSA = 60 * 60 * 1000; 

function saveBOT(data) { 
    const payload = { waktuSimpan: Date.now(), dataPasien: data };
    try { 
        GM_setValue('AUTO_CKG_DATA', JSON.stringify(payload)); 
        GM_setValue('LAST_USED_NIK', data.nik); 
    } catch(e) { 
        localStorage.setItem('AUTO_CKG_DATA', JSON.stringify(payload)); 
        localStorage.setItem('LAST_USED_NIK', data.nik); 
    }
}

function loadBOT() { 
    let raw;
    try { raw = GM_getValue('AUTO_CKG_DATA'); } catch(e) { raw = localStorage.getItem('AUTO_CKG_DATA'); }
    if (!raw) return null;
    try {
        const payload = JSON.parse(raw);
        if (payload.waktuSimpan) {
            const umurData = Date.now() - payload.waktuSimpan;
            if (umurData > WAKTU_KEDALUWARSA) { clearBOT(); return null; }
            return payload.dataPasien;
        }
        return payload; 
    } catch(e) { return null; }
}

function clearBOT() { 
    try { GM_deleteValue('AUTO_CKG_DATA'); } catch(e) { localStorage.removeItem('AUTO_CKG_DATA'); }
}

function getCompleted() { 
    try { return JSON.parse(GM_getValue('AUTO_CKG_COMPLETED') || '[]'); } catch(e) { return JSON.parse(localStorage.getItem('AUTO_CKG_COMPLETED') || '[]'); }
}
function addCompleted(id) {
    const arr = getCompleted();
    if(!arr.includes(id)) arr.push(id);
    try { GM_setValue('AUTO_CKG_COMPLETED', JSON.stringify(arr)); } catch(e) { localStorage.setItem('AUTO_CKG_COMPLETED', JSON.stringify(arr)); }
}
function clearCompleted() { 
    try { GM_deleteValue('AUTO_CKG_COMPLETED'); } catch(e) { localStorage.removeItem('AUTO_CKG_COMPLETED'); }
}

/* =========================================================
   INDEXEDDB CACHE HELPER
========================================================= */
const DB_NAME = 'CKG_CACHE_DB_DEWASA';
const STORE_NAME = 'SheetDataStore';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getCacheDB(key) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    } catch (e) { return null; }
}

async function setCacheDB(key, value) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const req = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
        });
    } catch (e) { return false; }
}

/* =========================================================
   DATA MATCHER (OPTIMASI DENGAN CACHE & ANTI-CORS)
========================================================= */
function parseCSV(text) {
    if (!text) return [];
    const rows = []; let row = []; let current = ""; let insideQuote = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i]; const next = text[i + 1];
        if (char === '"') {
            if (insideQuote && next === '"') { current += '"'; i++; } else { insideQuote = !insideQuote; }
        } else if (char === ',' && !insideQuote) {
            row.push(current); current = "";
        } else if ((char === '\n' || char === '\r') && !insideQuote) {
            if (current || row.length) { row.push(current); rows.push(row); row = []; current = ""; }
        } else { current += char; }
    }
    if (current || row.length) { row.push(current); rows.push(row); }
    return rows;
}
        
let cachedSheetData = null;

async function cariData(nikInput) {
    try {
        const target = normalizeNIK(nikInput);
        if (!cachedSheetData || cachedSheetData.length === 0) {
            let savedCache = null; let cacheTime = 0;
            const EXPIRATION_TIME = 2 * 60 * 1000; 
            const now = Date.now();

            try { savedCache = await getCacheDB('CKG_SHEET_DATA'); cacheTime = await getCacheDB('CKG_SHEET_TIME') || 0; } catch(e) { }

            if (savedCache && savedCache.length > 0 && (now - cacheTime < EXPIRATION_TIME)) {
                cachedSheetData = savedCache;
            } else {
                updateStatus("MENGUNDUH DATA SPREADSHEET...");
                cachedSheetData = [];
                for (const gid of GIDS) {
                    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}&t=${Date.now()}`;
                    const res = await fetch(url);
                    if (!res.ok) continue;
                    const csvText = await res.text();
                    if (!csvText) continue;
                    
                    if (csvText.toLowerCase().includes('<!doctype html>') || csvText.toLowerCase().includes('<html')) {
                        alert("🔴 ERROR AKSES GOOGLE SHEET!\n\nBot mendownload halaman HTML, bukan data.\nPastikan Google Sheet Anda di set 'Anyone with the link can view'.");
                        return null;
                    }

                    const rows = parseCSV(csvText);
                    if (rows && rows.length > 1) {
                        if (cachedSheetData.length === 0) cachedSheetData = rows;
                        else for (let i = 1; i < rows.length; i++) cachedSheetData.push(rows[i]);
                    }
                }
                
                if (cachedSheetData.length > 0) {
                    try { await setCacheDB('CKG_SHEET_DATA', cachedSheetData); await setCacheDB('CKG_SHEET_TIME', now); } catch(e) {}
                }
            }
        }

        const rows = cachedSheetData;
        if (!rows || rows.length < 2) return null;
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length < 5) continue; 
            const cells = row.map(col => String(col || '').trim());
            const rawNik = (cells.length > 2) ? (cells[0] || cells[1] || cells[2]) : '';
            
            if (normalizeNIK(rawNik) === target || cells.some(col => normalizeNIK(col) === target)) {
                
                let extractedTglLahir = '';
                for (let colIdx = 4; colIdx <= 9; colIdx++) {
                    if (cells[colIdx] && /(19\d{2}|20\d{2})/.test(cells[colIdx])) {
                        extractedTglLahir = cells[colIdx];
                        break;
                    }
                }

                return {
                    nik: target, 
                    nama: cells[7] || '', 
                    tglLahir: extractedTglLahir,
                    sistole: cells[36] || '120', diastole: cells[37] || '80',
                    bb: cells[39] || '60', tb: cells[40] || '165', lp: cells[41] || '80', gula: cells[54] || '110',
                    mata: cells[68] || 'Tidak', merokok: cells[69] || '', skilasKog1: (cells[74] || 'Ya').trim(),
                    skilasKog2: (cells[75] || 'Benar semua').trim(), skilasKog3: (cells[76] || 'Ya').trim(),
                    skilasMob:  (cells[77] || 'Ya').trim(), skilasMal1: (cells[78] || 'Tidak').trim(),
                    skilasMal2: (cells[79] || 'Tidak').trim(), skilasMal3: (cells[80] || 'Tidak').trim(),
                    skilasDep1: (cells[81] || 'Tidak').trim(), skilasDep2: (cells[82] || 'Tidak').trim()
                };
            }
        }
        
        await setCacheDB('CKG_SHEET_TIME', 0);
        cachedSheetData = null;

        return null; 
    } catch (error) {
        sendBotErrorLog("cariData", error.message || error);
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
    try {
        let finalValue = String(value || '');
        if (element.type === 'number') {
            finalValue = finalValue.replace(/,/g, '.');
        } else {
            finalValue = finalValue.replace(/\./g, ',');
        }

        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        nativeSetter.call(element, finalValue);
        
        if (element._valueTracker) { element._valueTracker.setValue(''); }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        element.blur();
    } catch(e) {}
}

/* =========================================================
   SURVEYJS DROPDOWN & RADIO & SMART SEARCH ENGINE
========================================================= */
async function isiInputBySoal(keywords, value) {
    if(!BOT_RUNNING || !value) return false;
    
    const keywordArr = Array.isArray(keywords) ? keywords : [keywords];
    const questions = [...document.querySelectorAll('.sd-question, .sv-question, .ant-form-item, .form-group')];
    const inputs = [...document.querySelectorAll('input:not([type="radio"]):not([type="checkbox"])')];

    for (let kw of keywordArr) {
        const lowerKw = kw.toLowerCase();

        let targetQ = questions.find(q => (q.innerText || '').toLowerCase().includes(lowerKw));
        if (targetQ) {
            const input = targetQ.querySelector('input');
            if (input) { forceInject(input, value); await sleep(500); return true; }
        }

        let targetInput = inputs.find(i => (i.placeholder || '').toLowerCase().includes(lowerKw));
        if (targetInput) { forceInject(targetInput, value); await sleep(500); return true; }

        for (let input of inputs) {
            const parentText = (input.parentElement.innerText || '').toLowerCase();
            if (parentText.includes(lowerKw)) {
                forceInject(input, value); await sleep(500); return true;
            }
        }
    }
    return false;
}

async function selectDropdownContext(soalText, optionText) {
    if(!BOT_RUNNING) return false;

    let targetQ = null;
    if (soalText) {
        const questions = [...document.querySelectorAll('.sd-question, .sv-question, .sd-element')];
        targetQ = questions.find(q => (q.innerText || '').toLowerCase().includes(soalText.toLowerCase()));
    }

    if (!targetQ) {
        const allDropdowns = document.querySelectorAll('.sd-dropdown, .sv-dropdown');
        if (allDropdowns.length > 0) {
            targetQ = allDropdowns[0].closest('.sd-question, .sv-question, .sd-element') || allDropdowns[0].parentElement;
        } else {
            return false;
        }
    }

    const dropdown = targetQ.querySelector('.sd-dropdown, .sv-dropdown');
    if (!dropdown) return false;

    triggerClick(dropdown); await sleep(1000);

    const listId = dropdown.getAttribute('aria-controls');
    let listElement = listId ? document.getElementById(listId) : null;
    if (!listElement) listElement = document.querySelector('.sv-popup--show, .sd-popup--show, .sv-list, .sd-list');
    
    if (!listElement) { triggerClick(dropdown); return false; }
    
    const searchInput = document.querySelector('input[type="text"][role="combobox"], input[aria-expanded="true"]');
    if (searchInput) { forceInject(searchInput, optionText.charAt(0)); await sleep(500); }

    const options = [...listElement.querySelectorAll('.sv-list__item-body, .sd-list__item-body')];
    const targetOpt = options.find(el => (el.innerText || '').trim().toLowerCase().includes(optionText.toLowerCase()));

    if (targetOpt) { triggerClick(targetOpt); await sleep(500); return true; } 
    else { triggerClick(dropdown); return false; }
}

async function pilihSemuaRadioLimit(text, limit = 99, exact = false) {
    let clicked = 0;
    const items = [...document.querySelectorAll('label, .ant-radio-wrapper, .sd-item, .sv-item')];
    
    for (const el of items) {
        if (!BOT_RUNNING || clicked >= limit) break;
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

async function isiRadioSurveyJS(soalSelector, teksJawaban) {
    if(!BOT_RUNNING) return false;
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
    try {
        updateStatus('MENGISI: TELINGA & MATA...');
        await isiRadioSurveyJS('serumen impaksi', 'tidak ada serumen impaksi'); await sleep(500);
        await selectDropdownContext('infeksi', 'tidak ada infeksi'); await sleep(500);
        await isiRadioSurveyJS('tajam pendengaran', 'normal'); await sleep(500);

        if ((data.mata || '').toLowerCase() === 'ya') {
            await isiRadioSurveyJS('tajam penglihatan', 'curiga gangguan penglihatan'); await sleep(1500);
            await isiRadioSurveyJS('hasil pemeriksaan visus', 'gangguan penglihatan ringan');
        } else {
            await isiRadioSurveyJS('tajam penglihatan', 'normal (visus 6/6 - 6/12)');
        }
        await sleep(500);
        await isiRadioSurveyJS('pupil', 'normal');
    } catch(e) { sendBotErrorLog("handleTelingaMata", e); }
}

/* =========================================================
   KLIK KIRIM & VALIDASI
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
    try {
        if(!BOT_RUNNING) return false;
        updateStatus('Validasi form...');
        await sleep(2000);
        
        let check = isFormValid();
        let loopSafety = 0;
        
        while (!check.valid && BOT_RUNNING && loopSafety < 10) {
            loopSafety++;
            updateStatus('Mengisi soal kosong otomatis...');
            const labels = check.container.querySelectorAll('label');
            let foundDefaultAnswer = false; 

            for (let l of labels) {
                let labelText = l.innerText.toLowerCase();
                if (labelText.includes('normal') || labelText.includes('tidak')) {
                    const input = l.querySelector('input[type="radio"]');
                    if (input && !input.checked) {
                        input.click(); input.dispatchEvent(new Event('change', { bubbles: true }));
                        await sleep(800); foundDefaultAnswer = true; break; 
                    }
                }
            }

            if (!foundDefaultAnswer) {
                updateStatus('Terjebak soal wajib.\nSilakan isi manual lalu klik Kirim.');
                sendBotErrorLog("klikKirim_Validasi", "Gagal auto-fill opsi Normal/Tidak pada soal spesifik.");
                return false;
            }
            await sleep(1000); check = isFormValid(); 
        }

        if(!BOT_RUNNING) return false;
        const btn = document.querySelector('.sd-navigation__complete-btn') || [...document.querySelectorAll('button')].find(b => (b.innerText||'').toLowerCase().includes('kirim'));
        
        if (btn) {
            updateStatus('Mengirim data...');
            btn.click();
            await sleep(4000);
            return true;
        } else {
            updateStatus('Tombol kirim tidak ketemu!');
            return false;
        }
    } catch(e) {
        sendBotErrorLog("klikKirim_Error", e);
        return false;
    }
}

/* =========================================================
   FORM FILLER LOGIC
========================================================= */
async function autoContinueForm() {
    try {
        const data = loadBOT();
        if (!data) { updateStatus('IDLE\nSiap Digunakan'); return; }

        BOT_RUNNING = true;
        updateStatus('MENUNGGU FORM DIMUAT...');
        
        for(let i = 0; i < 25; i++) {
            if(!BOT_RUNNING) return;
            if(document.querySelector('.sd-question, .sv-question, input')) break;
            await sleep(800);
        }
        await sleep(1000); 
        if(!BOT_RUNNING) return;

        const title = document.body.innerText.toLowerCase();
        let currentId = null;

        // TAHAP 1: GIZI
        if(title.includes('gizi (bb') || title.includes('gizi') || title.includes('lingkar perut')){
            currentId = 'gizi'; updateStatus('MENGISI TAHAP: GIZI');
            await isiInputBySoal(['berat badan', 'satuan kg'], data.bb);
            await isiInputBySoal(['tinggi badan', 'satuan cm'], data.tb);
            await isiInputBySoal(['lingkar perut', 'hasil pengukuran'], data.lp);
        }
        // TAHAP 2: GULA
        else if(title.includes('gula darah')){
            currentId = 'gula'; updateStatus('MENGISI TAHAP: GULA DARAH');
            await pilihSemuaRadioLimit('tidak', 99, true); await sleep(800);
            await isiInputBySoal(['sewaktu', 'gula darah', 'mg/dl'], data.gula);
        }
        // TAHAP 3: TENSI
        else if(title.includes('tekanan darah')){
            currentId = 'tensi'; updateStatus('MENGISI TAHAP: TEKANAN DARAH');
            await pilihSemuaRadioLimit('tidak', 99, true); await sleep(800);
            await isiInputBySoal(['sistol', 'sistolik'], data.sistole);
            await isiInputBySoal(['diastol', 'diastolik'], data.diastole);
        }
        // TAHAP 4: PTM LAINNYA
        else if(title.includes('frambusia')){ currentId = 'frambusia'; updateStatus('MENGISI TAHAP: FRAMBUSIA'); await pilihSemuaRadioLimit('tidak ada', 99, false); await selectDropdownContext('', 'tidak ada'); }
        else if(title.includes('kusta')){ currentId = 'kusta'; updateStatus('MENGISI TAHAP: KUSTA'); await selectDropdownContext('', 'tidak ada'); }
        else if(title.includes('skabies')){ currentId = 'skabies'; updateStatus('MENGISI TAHAP: SKABIES'); await selectDropdownContext('', 'tidak ada'); }
        else if(title.includes('telinga dan mata')){ currentId = 'telinga_mata'; await handleTelingaMata(data); }
        else if(title.includes('karies')){ currentId = 'karies'; updateStatus('MENGISI TAHAP: KARIES'); await pilihSemuaRadioLimit('tidak', 1, true); await selectDropdownContext('', 'tidak'); }
        else if(title.includes('periodontal')){ currentId = 'periodontal'; updateStatus('MENGISI TAHAP: PERIODONTAL'); await pilihSemuaRadioLimit('tidak', 2, true); await selectDropdownContext('', 'tidak'); }
        
        // TAHAP 5: KANKER PARU
        else if(title.includes('skrining kanker paru') && (title.includes('riwayat merokok') || title.includes('skrining kanker paru'))) {
            currentId = 'kanker_paru'; updateStatus('MENGISI TAHAP: KANKER PARU'); await sleep(2000);
            let isPerokok = (data.merokok || '').toLowerCase().includes('ya') || (data.merokok || '').toLowerCase().includes('rokok');
            await isiRadioSurveyJS('didiagnosis atau menderita kanker', 'tidak pernah didiagnosis');
            await isiRadioSurveyJS('ada anggota keluarga yang menderita kanker', 'tidak ada keluarga');
            await isiRadioSurveyJS('riwayat merokok', isPerokok ? 'perokok aktif' : 'tidak pernah merokok');
            await isiRadioSurveyJS('zat karsinogenik', 'Tidak tempat kerja mengandung zat karsinogenik');
            await isiRadioSurveyJS('berpotensi tinggi', 'Tidak memiliki tempat tinggal berpotensi tinggi');
            await isiRadioSurveyJS('dalam rumah yang tidak sehat', 'Memiliki lingkungan dalam rumah yang sehat');
            await isiRadioSurveyJS('penyakit paru kronik', 'tidak pernah didiagnosis penyakit paru kronik');
            await sleep(500);
        }
        // TAHAP 6: PUMA
        else if(title.includes('puma') || title.includes('ppok')){
            currentId = 'puma'; updateStatus('MENGISI TAHAP: PPOK (PUMA)');
            
            let umur = hitungUmur(data.tglLahir);
            let opsiUmur = '';
            
            if (umur >= 40 && umur <= 49) {
                opsiUmur = '40-49';
            } else if (umur >= 50 && umur <= 59) {
                opsiUmur = '50-59';
            } else if (umur >= 60) {
                opsiUmur = '=>60';
            }

            if (opsiUmur !== '') {
                let success = await isiRadioSurveyJS('usia - skor puma', opsiUmur);
                if (!success) {
                    const labels = [...document.querySelectorAll('label')];
                    const targetLabel = labels.find(l => (l.innerText || '').includes(opsiUmur));
                    if (targetLabel) {
                        const input = targetLabel.querySelector('input[type="radio"]');
                        if (input && !input.checked) {
                            input.click(); input.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                }
                await sleep(500);
            }

            let isPerokok = (data.merokok || '').toLowerCase().includes('ya') || (data.merokok || '').toLowerCase().includes('rokok');
            await isiRadioSurveyJS('mempunyai riwayat merokok', isPerokok ? 'iya' : 'tidak'); await sleep(400);
            await isiRadioSurveyJS('napas pendek', 'tidak');
            await isiRadioSurveyJS('mempunyai dahak', 'tidak');
            await isiRadioSurveyJS('batuk saat sedang tidak menderita', 'tidak');
            await isiRadioSurveyJS('spirometri', 'tidak'); await sleep(500);
        }
        // TAHAP 7: LANSIA (SKILAS)
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
            currentId = 'skilas_dep'; updateStatus('MENGISI TAHAP: DEPRESI');
            await selectDropdownContext('merasa sedih, tertekan', (data.skilasDep1 || 'tidak').trim()); await sleep(500);
            await selectDropdownContext('sedikit minat atau kesenangan', (data.skilasDep2 || 'tidak').trim());
        }

        if(!BOT_RUNNING) return;
        if(currentId) addCompleted(currentId);
        await klikKirim();
        updateStatus('Menunggu sistem pindah halaman...');
        
    } catch(e) {
        sendBotErrorLog("autoContinueForm_GiantSwitch", e.message || e);
        updateStatus("Melewati error, mencoba antrean lain...");
    }
}

/* =========================================================
   TRACKER ROUTER & ESTAFET UI [SMART DOM TRAVERSAL DEWASA]
========================================================= */
function getNextTarget() {
    try {
        const completed = getCompleted();
        const formRows = [...document.querySelectorAll('div[id^="rowfrm"]')];
        
        for (let row of formRows) {
            const allElements = [...row.querySelectorAll('*')];
            let actionBtn = allElements.find(el => {
                const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                return (txt === 'input data' || txt === 'ubah data') && el.children.length === 0;
            });

            if (!actionBtn) {
                actionBtn = allElements.find(el => (el.innerText || '').trim().toLowerCase().includes('input data'));
            }

            if (!actionBtn) continue;

            let rowContainer = row.closest('.grid') || row.closest('.border-y-solid') || row.parentElement.parentElement;
            
            if (rowContainer) {
                const titleCol = rowContainer.querySelector('.col-span-2') || rowContainer;
                const txt = (titleCol.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
                const found = TARGETS.find(t => txt.includes(t.txt));
                
                if (found && !completed.includes(found.id)) {
                    return { btn: actionBtn, id: found.id, title: found.txt };
                }
            }
        }
        return null;
    } catch (e) {
        sendBotErrorLog("getNextTarget", e.message || e);
        return null;
    }
}

async function mainLoopCKG(data){
    try {
        updateStatus('MENCARI ANTRIAN...');
        await sleep(2000); 
        
        let nextItem = getNextTarget();
        if(!nextItem) {
            await sleep(2000);
            nextItem = getNextTarget();
        }

        if(!BOT_RUNNING) return;

        if(!nextItem){
            clearBOT(); clearCompleted(); BOT_RUNNING = false;
            try { GM_deleteValue('PASIEN_AKTIF'); } catch(e) { localStorage.removeItem('PASIEN_AKTIF'); }
            playSound('selesai'); 
            
            updateStatus('SELESAI SEMUA PEMERIKSAAN\nSilakan pilih menu selanjutnya.'); 
            syncUI(); 

            showToast("BOT SUKSES INPUT SEMUA PEMERIKSAAN!", "success");
            return;
        }
        
        updateStatus('MEMBUKA TARGET:\n' + nextItem.title.toUpperCase());
        await sleep(1000);
        triggerClick(nextItem.btn);
    } catch(e) {
        sendBotErrorLog("mainLoopCKG", e.message || e);
        await sleep(2000);
    }
}

/* =========================================================
   UI MODERN & DRAGGABLE
========================================================= */
function updateStatus(text){ const el = document.getElementById('bot-status'); if(el) el.innerText = text; }

function stopBOT(){ 
    BOT_RUNNING = false; 
    clearBOT(); clearCompleted(); 
    try { GM_deleteValue('LAST_USED_NIK'); } catch(e) { localStorage.removeItem('LAST_USED_NIK'); }
    updateStatus('BOT DIHENTIKAN. DATA DIRESET.'); 
    showToast("Proses bot dihentikan secara paksa.", "warning");
    syncUI();
}

function syncUI() {
    const data = loadBOT();
    const btnStart = document.getElementById('run-bot');
    const inputNik = document.getElementById('nik-bot');
    const estafetWrap = document.getElementById('estafet-wrap');
    const statusEl = document.getElementById('bot-status');

    if (!btnStart || !inputNik || !estafetWrap) return;

    if (data) {
        btnStart.style.display = 'none'; 
        estafetWrap.style.display = 'none'; 
        inputNik.value = data.nik || ''; 
        inputNik.disabled = true;
    } else {
        btnStart.style.display = 'block'; 
        
        let estafetRaw = null;
        try { estafetRaw = GM_getValue('PASIEN_AKTIF'); } catch(e) { estafetRaw = localStorage.getItem('PASIEN_AKTIF'); }
        let estafetNik = '';
        if (estafetRaw) {
            try { estafetNik = JSON.parse(estafetRaw).nik; } catch(e){}
        }

        let lastNik = null;
        try { lastNik = GM_getValue('LAST_USED_NIK'); } catch(e) { lastNik = localStorage.getItem('LAST_USED_NIK'); }
        
        let activeNik = estafetNik || lastNik;

        if (activeNik) {
            estafetWrap.style.display = 'flex';
            if (inputNik.value === '') inputNik.value = activeNik; 
            inputNik.disabled = false;
        } else {
            estafetWrap.style.display = 'none'; 
            inputNik.value = ''; 
            inputNik.disabled = false; 
            if(statusEl && !statusEl.innerText.includes('DIHENTIKAN')) {
                updateStatus('Siap Digunakan. Masukkan NIK.');
            }
        }
    }
}

function createUI(){
    if (!document.body || !document.head) return;
    if (document.getElementById('auto-ckg-ui')) return;

    const box = document.createElement('div'); 
    box.id = 'auto-ckg-ui';
    box.innerHTML = `
        <div id="drag-handle">INPUT CKG TALAGA BODAS</div>
        <div id="bot-status">Menyiapkan Database, Klik Start !...</div>
        <input id="nik-bot" placeholder="Masukkan NIK">
        <div id="btn-wrap">
            <button id="run-bot">START</button><button id="stop-bot">BATAL</button>
        </div>
        <div id="estafet-wrap" style="display:none; gap:8px; margin-top:8px;">
            <button id="btn-to-skrining" style="flex:1; background:#3b82f6; color:#fff; border:none; padding:8px; border-radius:8px; cursor:pointer; font-weight:bold; transition:0.2s; box-shadow:0 2px 5px rgba(0,0,0,0.5);">⏮️ SKRINING</button>
            <button id="btn-to-daftar" style="flex:1; background:#6b7280; color:#fff; border:none; padding:8px; border-radius:8px; cursor:pointer; font-weight:bold; transition:0.2s; box-shadow:0 2px 5px rgba(0,0,0,0.5);">🔙 DAFTAR</button>
        </div>
    `;

    if (!document.getElementById('auto-ckg-style')) {
        const style = document.createElement('style');
        style.id = 'auto-ckg-style';
        style.innerHTML = `
            #auto-ckg-ui {
                position: fixed; top: 100px; right: 20px; width: 300px;
                background: rgba(15, 15, 15, 0.95); backdrop-filter: blur(15px);
                border: 1px solid rgba(0, 255, 136, 0.5); border-radius: 16px;
                z-index: 2147483647; padding: 15px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
                font-family: 'Segoe UI', sans-serif; color: white; cursor: default;
            }
            #drag-handle {
                padding: 5px; text-align: center; font-weight: bold; color: #00ff88;
                cursor: move; margin-bottom: 10px; border-bottom: 1px solid #333;
            }
            #bot-status {
                background: rgba(0,0,0,0.4); border-radius: 8px; padding: 10px;
                min-height: 50px; margin-bottom: 10px; color: #00ff88; font-weight:bold;
                font-size: 13px; text-align: center; white-space: pre-wrap; display:flex; align-items:center; justify-content:center;
            }
            #nik-bot {
                width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #00ff88; font-weight:bold; text-align:center; outline:none;
                border-radius: 8px; background: #000; color: #00ff88; margin-bottom: 10px;
            }
            #btn-wrap { display: flex; gap: 8px; }
            #run-bot, #stop-bot {
                flex: 1; border: none; padding: 10px; border-radius: 8px;
                font-weight: bold; cursor: pointer; transition: 0.2s; box-shadow:0 2px 5px rgba(0,0,0,0.5);
            }
            #run-bot { background: #00ff88; color: #000; }
            #run-bot:hover { background: #00cc6a; }
            #stop-bot { background: #ff4444; color: white; }
            #stop-bot:hover { background: #cc0000; }
            #btn-to-skrining:hover { background: #2563eb; }
            #btn-to-daftar:hover { background: #4b5563; }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(box);

    const handle = document.getElementById('drag-handle');
    if (handle) {
        let isDragging = false, offsetX, offsetY;
        handle.addEventListener('mousedown', (e) => {
            isDragging = true;
            offsetX = e.clientX - box.offsetLeft;
            offsetY = e.clientY - box.offsetTop;
            box.style.opacity = "0.8";
        });
        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                box.style.left = (e.clientX - offsetX) + 'px';
                box.style.top = (e.clientY - offsetY) + 'px';
                box.style.right = 'auto';
            }
        });
        document.addEventListener('mouseup', () => {
            isDragging = false;
            box.style.opacity = "1";
        });
    }

    document.getElementById('run-bot').onclick = async ()=>{
        if(BOT_RUNNING) { showToast("Bot masih berjalan!", "warning"); return; }
        const nik = document.getElementById('nik-bot').value;
        if(!nik) { showToast("Masukkan NIK pasien!", "warning"); return; }

        updateStatus('MENGAMBIL DATA SPREADSHEET...');
        const data = await cariData(nik);
        if(!data) { 
            showToast("Data Pasien tidak ditemukan di Spreadsheet", "error"); 
            return updateStatus('DATA TIDAK DITEMUKAN'); 
        }

        BOT_RUNNING = true; saveBOT(data); clearCompleted();
        syncUI(); 
        
        updateStatus('MEMULAI BOT...');
        showToast("Memulai Injeksi Form Input...", "info");
        await sleep(500); await mainLoopCKG(data);
    };
    
    document.getElementById('stop-bot').onclick = stopBOT;

    const btnSkrining = document.getElementById('btn-to-skrining');
    if (btnSkrining) {
        btnSkrining.onclick = () => {
            const nik = document.getElementById('nik-bot').value;
            if(!confirm('Anda yakin ingin kembali ke Modul SKRINING?')) return;
            
            clearBOT(); clearCompleted(); 
            try { GM_deleteValue('LAST_USED_NIK'); } catch(e) { localStorage.removeItem('LAST_USED_NIK'); }
            
            try { 
                if (typeof GM_setValue !== "undefined") {
                    GM_setValue('PASIEN_AKTIF', JSON.stringify({ nik: nik, kategori: 'skrining' })); 
                    GM_setValue('CKG_MODE', 'skrining'); 
                } else {
                    localStorage.setItem('PASIEN_AKTIF', JSON.stringify({ nik: nik, kategori: 'skrining' })); 
                    localStorage.setItem('CKG_MODE', 'skrining'); 
                }
            } catch(e) {}
            
            updateStatus('Beralih ke Skrining...'); 
            showToast("Beralih ke Modul Skrining...", "success");
            setTimeout(() => location.reload(), 500); 
        };
    }
    
    const btnDaftar = document.getElementById('btn-to-daftar');
    if (btnDaftar) {
        btnDaftar.onclick = () => {
            if(!confirm('Anda yakin ingin mereset memori dan kembali ke daftar awal?')) return;
            
            clearBOT(); clearCompleted(); 
            try { 
                if (typeof GM_setValue !== "undefined") {
                    GM_deleteValue('LAST_USED_NIK'); 
                    GM_deleteValue('PASIEN_AKTIF'); 
                    GM_setValue('CKG_MODE', 'daftar');
                } else {
                    localStorage.removeItem('LAST_USED_NIK'); 
                    localStorage.removeItem('PASIEN_AKTIF'); 
                    localStorage.setItem('CKG_MODE', 'daftar');
                }
            } catch(e) { }
            
            updateStatus('Membersihkan data & memuat ulang...'); 
            showToast("Beralih ke Modul Pendaftaran...", "success");
            setTimeout(() => location.reload(), 500); 
        };
    }
    
    syncUI();
}

/* =========================================================
   INIT / AUTO RESUME OBSERVER (SAFE HYDRATION)
========================================================= */
function startBotEngine() {
    setTimeout(() => {
        createUI();
        setInterval(createUI, 1500);

        setInterval(async () => {
            try {
                const currentUrl = window.location.href;
                const isFormPage = currentUrl.includes('form.kemkes.go.id') || document.querySelector('.sd-root-modern, .sv-root-modern, .sd-page'); 
                const isMainPage = currentUrl.includes('sehatindonesiaku.kemkes.go.id'); 

                if (BOT_RUNNING) return;

                if (isFormPage) {
                    BOT_RUNNING = true;
                    await autoContinueForm();
                    BOT_RUNNING = false;
                } else if (isMainPage) {
                    let data = loadBOT();
                    let estafetRaw = null;
                    try { estafetRaw = GM_getValue('PASIEN_AKTIF'); } catch(e) { estafetRaw = localStorage.getItem('PASIEN_AKTIF'); }

                    if (estafetRaw && !data) {
                        const estafet = JSON.parse(estafetRaw);
                        if (estafet.kategori === 'dewasa') {
                            updateStatus('Estafet Dewasa Diterima. Mengunduh data...');
                            data = await cariData(estafet.nik); 
                            if (data) {
                                saveBOT(data);
                                playSound('sukses');
                            } else {
                                try { GM_deleteValue('PASIEN_AKTIF'); } catch(e) { localStorage.removeItem('PASIEN_AKTIF'); }
                                updateStatus('Data estafet tidak ditemukan.');
                            }
                        }
                    }

                    if(data){
                        BOT_RUNNING = true;
                        updateStatus('MELANJUTKAN OTOMATIS...\nMencari Form Berikutnya');
                        await mainLoopCKG(data); 
                    }
                }
            } catch(e) {
                sendBotErrorLog("Interval_Supervisor", e.message || e);
            }
        }, 2000);
    }, 1500); // Tunggu 1.5 detik setelah window.load agar sidebar SATUSEHAT selesai render
}

if (document.readyState === 'complete') {
    startBotEngine();
} else {
    window.addEventListener('load', startBotEngine);
}
})(typeof GM_xmlhttpRequest !== "undefined" ? GM_xmlhttpRequest : null);
