(function (GM_xmlhttpRequest) {
'use strict';
    const request = GM_xmlhttpRequest;

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
                module: { stringValue: "SKRINING_MANDIRI_BOT" },
                context: { stringValue: context },
                message: { stringValue: String(errorMessage) }
            }
        };
        request({
            method: "POST",
            url: "https://firestore.googleapis.com/v1/projects/jadwal-daily-pkm-padasuka/databases/(default)/documents/Customer/Padasuka/error_logs",
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify(payload)
        });
    } catch(e) { }
}

/* =========================================================
   [EXPERT FEATURE] 2. TOAST NOTIFICATION (NON-BLOCKING UI)
========================================================= */
function showToast(message, type = 'info') {
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
    toast.style = `background:${bgColors[type] || bgColors.info}; color:#fff; padding:12px 20px; border-radius:8px; box-shadow:0 4px 15px rgba(0,0,0,0.3); font-family:sans-serif; font-size:14px; font-weight:bold; opacity:0; transform:translateX(50px); transition:all 0.3s ease; pointer-events:auto;`;
    toast.innerHTML = message;

    container.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(0)'; });

    setTimeout(() => {
        toast.style.opacity = '0'; toast.style.transform = 'translateX(50px)';
        setTimeout(() => toast.remove(), 300);
    }, 4500);
}

/* =========================================================
   MODUL AUDIO & DELAY
========================================================= */
const sleep = ms => new Promise(r => setTimeout(r,ms));
function normalizeNIK(v) { return String(v || '').replace(/\D/g,''); }

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
   CONFIG SPREADSHEET
========================================================= */
const SHEET_ID = '1aavWN9ScsvRBY1iZj9gY1GQ0AFgBieCe';
const GIDS = '1054280612';

/* =========================================================
   HELPER MAPPING JAWABAN MEROKOK
========================================================= */
function jawabanMerokok(v){
    const text = String(v || '').toLowerCase().trim();
    return (text.includes('ya') || text.includes('rokok') || text.includes('perokok')) ? 'ya' : 'tidak';
}

/* =========================================================
   SESSION & DYNAMIC TRACKER (100% LOCALSTORAGE)
========================================================= */
function getStore(key) { return localStorage.getItem(key); }
function setStore(key, value) { localStorage.setItem(key, value); }
function delStore(key) { localStorage.removeItem(key); }

function saveBOT(data) { 
    setStore('AUTO_SKRINING_DATA', JSON.stringify(data)); 
    setStore('LAST_USED_NIK', data.nik); 
}

function loadBOT() { 
    const raw = getStore('AUTO_SKRINING_DATA'); 
    if(!raw) return null; 
    try { return JSON.parse(raw); } catch(e) { return null; }
}

function clearBOT() { delStore('AUTO_SKRINING_DATA'); }

function getCompleted() { 
    try { return JSON.parse(getStore('AUTO_SKRINING_COMPLETED') || '[]'); } catch(e) { return []; }
}

function addCompleted(id) {
    const arr = getCompleted();
    if(!arr.includes(id)) arr.push(id);
    setStore('AUTO_SKRINING_COMPLETED', JSON.stringify(arr));
}

function clearCompleted() { delStore('AUTO_SKRINING_COMPLETED'); }

/* =========================================================
   DATA MATCHER (ANTI ERROR / FORMAT AMAN)
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
const DB_NAME = 'CKG_Database';
const STORE_NAME = 'SheetCache';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            if (!e.target.result.objectStoreNames.contains(STORE_NAME)) {
                e.target.result.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function setCacheDB(key, value) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(value, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    } catch(e) { return false; }
}

async function getCacheDB(key) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(tx.error);
        });
    } catch(e) { return null; }
}

async function cariData(nikInput) {
    try {
        const target = normalizeNIK(nikInput);
        if (!cachedSheetData || cachedSheetData.length === 0) {
            let savedCache = null; let cacheTime = 0;
            const EXPIRATION_TIME = 1 * 60 * 60 * 1000; 
            const now = Date.now();

            try { savedCache = await getCacheDB('CKG_SHEET_DATA'); cacheTime = await getCacheDB('CKG_SHEET_TIME') || 0; } catch(e) {}

            if (savedCache && savedCache.length > 0 && (now - cacheTime < EXPIRATION_TIME)) {
                cachedSheetData = savedCache;
            } else {
                updateStatus("MENGUNDUH DATA SPREADSHEET...");
                cachedSheetData = [];
                for (const gid of GIDS) {
                    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
                    try {
                        const res = await fetch(url);
                        if (!res.ok) continue;
                        const csvText = await res.text();
                        if (!csvText) continue;
                        const rows = parseCSV(csvText);
                        if (rows && rows.length > 1) {
                            if (cachedSheetData.length === 0) cachedSheetData = rows;
                            else for (let i = 1; i < rows.length; i++) cachedSheetData.push(rows[i]);
                        }
                    } catch(fetchErr) {
                        console.error("[CARI DATA] Error fetch GID:", gid, fetchErr);
                    }
                }
                try {
                    await setCacheDB('CKG_SHEET_DATA', cachedSheetData); await setCacheDB('CKG_SHEET_TIME', now);
                } catch(e) {}
            }
        }

        if (!cachedSheetData || cachedSheetData.length < 2) return null;

        for (let i = 1; i < cachedSheetData.length; i++) {
            const row = cachedSheetData[i];
            if (!row || row.length < 12) continue;
            const nikSheet = normalizeNIK(row[3]);
            if (nikSheet === target) {
                return {
                    nik: target, perkawinan: row[13] || 'Belum Menikah', merokok: (row[21] || '').trim(),
                    jiwa1: (row[72] || 'Tidak sama sekali').trim(), jiwa2: (row[73] || 'Tidak sama sekali').trim(), jiwa3: (row[74] || 'Tidak sama sekali').trim(), jiwa4: (row[75] || 'Tidak sama sekali').trim()  
                };
            }
        }
        return null;
    } catch (error) { 
        sendBotErrorLog("cariData_Skrining", error.message || error);
        return null; 
    }
}

/* =========================================================
   DOM INTERACTOR (SURVEYJS SAFE)
========================================================= */
function forceInject(element, value) {
    if (!element) return;
    try {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        nativeSetter.call(element, value);
        if (element._valueTracker) element._valueTracker.setValue('');
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        element.blur();
    } catch(e) { }
}

async function fillRadioSurveyJS(soalText, jawabanText) {
    try {
        const questions = [...document.querySelectorAll('.sd-question, .sv-question, .sd-element, [data-name]')];
        const allElements = [...document.querySelectorAll('*')];
        const aliases = {
            'faktor risiko tb': ['faktor risiko tb','tuberkulosis','tb','batuk','kontak erat','kontak dengan penderita'],
            'kesehatan jiwa': ['depresi','cemas','merasa sedih','minat melakukan aktivitas'],
            'kanker leher rahim': ['kanker leher rahim','serviks','pap smear','iva'],
            'gejala kanker paru': ['batuk dalam jangka waktu yang lama','batuk berdarah','sesak napas','nyeri dada','leher bengkak','benjolan pada leher','tidak sembuh-sembuh']
        };
        const keywords = aliases[soalText] || [soalText];
        const questionNode = allElements.find(el => {
            const txt = (el.textContent || '').toLowerCase(); return keywords.some(k => txt.includes(k.toLowerCase()));
        });

        if (!questionNode) return false;
        const targetQ = questionNode.closest('.sd-element') || questionNode.closest('[data-name]') || questionNode.closest('.sd-question') || questionNode;
        if (!targetQ) return false;

        const items = [...targetQ.querySelectorAll('.sd-item, .sv-item')];
        const targetItem = items.find(el => {
            const txt = (el.innerText || '').toLowerCase().trim(); const target = jawabanText.toLowerCase().trim();
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
            await sleep(500); return true;
        }
    } catch(e) {}
    return false;
}

async function selectDropdownContext(soalText, optionText, typeChar = 't') {
    try {
        const questions = [...document.querySelectorAll('.sd-question, .sv-question, .sd-element, [data-name]')];
        const targetQ = questions.find(q => {
            const qText = (q.innerText || '').toLowerCase(); return qText.includes(soalText.toLowerCase()) || soalText.toLowerCase().includes(qText);
        });

        if (!targetQ) return false;
        const dropdown = targetQ.querySelector('.sd-dropdown, .sv-dropdown');
        if (!dropdown) return false;

        dropdown.scrollIntoView({ behavior: 'smooth', block: 'center' }); dropdown.click(); await sleep(1000);

        const search = document.querySelector('input[type="text"][role="combobox"], input[aria-expanded="true"]');
        if (search && typeChar) {
            search.focus(); search.value = typeChar;
            search.dispatchEvent(new Event('input', { bubbles: true })); search.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(1000);
        }

        const opts = [...document.querySelectorAll('.sv-list__item-body, .sd-list__item-body')];
        const targetOpt = opts.find(el => (el.innerText || '').toLowerCase().includes(optionText.toLowerCase()));

        if (targetOpt) { targetOpt.click(); await sleep(500); if (document.activeElement) document.activeElement.blur(); return true; }
        dropdown.click();
    } catch (e) {}
    return false;
}

async function isiKesehatanJiwa(data) {
    try {
        const j1 = data.jiwa1 || ''; const j2 = data.jiwa2 || ''; const j3 = data.jiwa3 || ''; const j4 = data.jiwa4 || '';
        const semuaPertanyaan = [...document.querySelectorAll('.sd-question, .sd-element')];

        for (const q of semuaPertanyaan) {
            if(!BOT_RUNNING) break;
            const text = (q.innerText || '').toLowerCase(); let jawabanSheet = '';

            if (text.includes('bersemangat')) jawabanSheet = j1;
            else if (text.includes('murung') || text.includes('putus asa')) jawabanSheet = j2;
            else if (text.includes('gugup') || text.includes('cemas')) jawabanSheet = j3;
            else if (text.includes('khawatir') || text.includes('mengendalikan')) jawabanSheet = j4;

            if (jawabanSheet.trim() !== '') {
                let kataKunci = ''; const teksJawaban = jawabanSheet.toLowerCase();
                if (teksJawaban.includes('tidak')) kataKunci = 'tidak';
                else if (teksJawaban.includes('kurang')) kataKunci = 'kurang';
                else if (teksJawaban.includes('lebih')) kataKunci = 'lebih';
                else if (teksJawaban.includes('hampir')) kataKunci = 'hampir';

                if (kataKunci !== '') {
                    const pilihan = [...q.querySelectorAll('.sd-item, .sv-item, label')];
                    const targetPilihan = pilihan.find(el => (el.innerText || '').toLowerCase().includes(kataKunci));

                    if (targetPilihan) {
                        targetPilihan.scrollIntoView({ behavior: 'smooth', block: 'center' }); await sleep(300);
                        const decorator = targetPilihan.querySelector('.sd-radio__decorator, .sd-item__decorator, .sv-item__decorator');
                        if (decorator) { decorator.click(); } else { targetPilihan.click(); }
                        const inputAsli = targetPilihan.querySelector('input[type="radio"]');
                        if (inputAsli) {
                            inputAsli.click(); inputAsli.checked = true;
                            inputAsli.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                            inputAsli.dispatchEvent(new Event('input', { bubbles: true }));
                            inputAsli.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                        await sleep(600); 
                    }
                }
            }
        }
    } catch(e) { }
}

async function isiTetanusCatin() {
    try {
        const judul = document.body.innerText.toLowerCase();
        if (!judul.includes('riwayat imunisasi tetanus')) return false;

        updateStatus('Mengisi Imunisasi Tetanus Catin...');
        await selectDropdownContext('pernah mendapatkan imunisasi tetanus', 'pernah imunisasi tetanus tetapi tidak ingat berapa kali');
        await sleep(1000);

        if(!BOT_RUNNING) return false;
        const btnKirim = document.querySelector('.sd-navigation__complete-btn') || [...document.querySelectorAll('button,input[type="button"]')].find(el => (el.value || el.innerText || '').toLowerCase().includes('kirim'));
        if (btnKirim) { btnKirim.click(); await sleep(3000); }
        return true;
    } catch(e) { return false; }
}

async function isiImunisasiBalita() {
    try {
        const judul = document.body.innerText.toLowerCase();
        if (!judul.includes('riwayat imunisasi rutin balita')) return false;

        updateStatus('Mengisi Imunisasi Balita Berantai...');
        let jumlahSoalTerjawab = 0; let maksimalLoop = 0;

        while (maksimalLoop < 20 && BOT_RUNNING) {
            maksimalLoop++;
            const semuaSoal = [...document.querySelectorAll('.sd-question, .sv-question, .sd-element')].filter(q => q.offsetParent !== null);
            if (semuaSoal.length === 0 || semuaSoal.length === jumlahSoalTerjawab) break; 

            for (let i = jumlahSoalTerjawab; i < semuaSoal.length; i++) {
                if(!BOT_RUNNING) break;
                const soalSaatIni = semuaSoal[i];
                soalSaatIni.scrollIntoView({ behavior: 'smooth', block: 'center' }); await sleep(500);

                const dropdown = soalSaatIni.querySelector('.sd-dropdown, .sv-dropdown');
                if (dropdown) {
                    const teksKotak = (dropdown.innerText || '').toLowerCase().trim();
                    if (teksKotak === 'ya' || teksKotak === 'sudah' || teksKotak.includes('ya') || teksKotak.includes('sudah')) continue;
                    dropdown.click(); await sleep(800); 

                    const opsiList = [...document.querySelectorAll('.sv-list__item-body, .sd-list__item-body, .sv-list__item, .sd-list__item')].filter(el => {
                        const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0;
                    });
                    const targetOpsi = opsiList.find(el => { const txt = (el.innerText || '').toLowerCase().trim(); return txt === 'ya' || txt === 'sudah'; });

                    if (targetOpsi) {
                        targetOpsi.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                        targetOpsi.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                        targetOpsi.click();
                    } else { dropdown.click(); }
                } else {
                    const radioItems = [...soalSaatIni.querySelectorAll('.sd-item, .sv-item')];
                    for (const item of radioItems) {
                        const txt = (item.innerText || '').toLowerCase().trim();
                        if (txt === 'ya' || txt === 'sudah') {
                            const decorator = item.querySelector('.sd-radio__decorator, .sd-item__decorator') || item;
                            decorator.click(); break;
                        }
                    }
                }
                await sleep(1000); 
            }
            jumlahSoalTerjawab = semuaSoal.length;
        }
        await sleep(1000);

        if(!BOT_RUNNING) return false;
        const btnKirim = document.querySelector('.sd-navigation__complete-btn') || [...document.querySelectorAll('button,input[type="button"]')].find(b => (b.innerText||'').toLowerCase().match(/lanjut|kirim/));
        if (btnKirim) { btnKirim.click(); await sleep(3500); }
        return true;
    } catch(e) { return false; }
}

/* =========================================================
   CORE LOGIC SKRINING MANDIRI 
========================================================= */
async function handleSkriningMandiri(data) {
    try {
        const pageText = document.body.innerText.toLowerCase();

        if (pageText.includes('status perkawinan') && BOT_RUNNING) {
            updateStatus('Status di Sheet: ' + data.perkawinan); await sleep(1000); 
            if (data.perkawinan && data.perkawinan !== 'Data Kosong') {
                let p = data.perkawinan.toLowerCase(); let target = 'Menikah'; 
                if (p.includes('belum')) target = 'Belum Menikah';
                else if (p.includes('janda') || p.includes('duda') || p.includes('cerai')) target = 'Cerai Hidup'; 
                updateStatus('Mengisi: ' + target);
                await fillRadioSurveyJS('status perkawinan', target); await sleep(1000);
            } else { updateStatus('Data Perkawinan Kosong!'); await sleep(1000); }
        }

        if ((pageText.includes('faktor risiko tb') || pageText.includes('tuberkulosis')) && BOT_RUNNING) {
            await fillRadioSurveyJS('faktor risiko tb', 'tidak batuk'); await fillRadioSurveyJS('faktor risiko tb', 'tidak');
        }
        if (pageText.includes('disabilitas') && BOT_RUNNING) { await fillRadioSurveyJS('disabilitas', 'non disabilitas'); }
        if ((pageText.includes('2 minggu terakhir') || pageText.includes('kesehatan jiwa')) && BOT_RUNNING) { await isiKesehatanJiwa(data); }
        if (pageText.includes('kanker leher rahim') && BOT_RUNNING) {
            let p = (data.perkawinan || '').toLowerCase(); let isYes = p.includes('menikah') || p.includes('cerai') || (p.includes('kawin') && !p.includes('belum'));
            await fillRadioSurveyJS('kanker leher rahim', isYes ? 'ya' : 'tidak');
        }

        if ((pageText.includes('merokok') || pageText.includes('kanker paru')) && BOT_RUNNING) {
            const statusMerokok = jawabanMerokok(data.merokok); 
            const semuaPertanyaan = [...document.querySelectorAll('.sd-question, .sd-element')];

            for (const q of semuaPertanyaan) {
                if(!BOT_RUNNING) break;
                const text = (q.innerText || '').toLowerCase(); let targetJawaban = '';

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

        const questions = document.querySelectorAll('.sd-question, .sv-question, .sd-element, [data-name]');
        questions.forEach(q => {
            if(!BOT_RUNNING) return;
            let isAnswered = false; const radios = q.querySelectorAll('input[type="radio"]');
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
                        decorator.click(); i.checked = true; 
                        i.dispatchEvent(new Event('input', { bubbles:true }));
                        i.dispatchEvent(new Event('change', { bubbles:true }));
                    }
                }
            });
        });

        if (pageText.includes('aktivitas fisik') && BOT_RUNNING) {
            updateStatus('Mengisi Aktivitas Fisik...');
            const inputAngka = [...document.querySelectorAll('input[type="number"]')];
            if (inputAngka.length > 0) {
                if (inputAngka[0]) forceInject(inputAngka[0], '3'); await sleep(500);
                if (inputAngka[1]) forceInject(inputAngka[1], '3'); await sleep(500);
            }

            const dropdowns = [...document.querySelectorAll('.sd-dropdown, .sv-dropdown')];
            for (let i = 0; i < dropdowns.length; i++) {
                if(!BOT_RUNNING) break;
                const currentDropdown = dropdowns[i];
                if (!currentDropdown) continue;
                currentDropdown.scrollIntoView({ behavior: 'smooth', block: 'center' }); currentDropdown.click(); await sleep(1200);

                const opsiTidak = [...document.querySelectorAll('li.sv-list__item, li.sd-list__item')].filter(li => li.innerText.trim().toLowerCase() === 'tidak');
                if (opsiTidak[i]) {
                    opsiTidak[i].click(); opsiTidak[i].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await sleep(500);
                } else { break; }
            }
        }

        await sleep(1500);
        if(!BOT_RUNNING) return;

        const btnNext = document.querySelector('.sd-navigation__next-btn, .sd-navigation__complete-btn') || [...document.querySelectorAll('button')].find(b => (b.innerText||'').toLowerCase().match(/lanjut|kirim/));
        if (btnNext) { 
            updateStatus('Mengirim data form...');
            btnNext.click(); 
            await sleep(3500); 
        }
    } catch(e) {
        sendBotErrorLog("handleSkriningMandiri", e.message || e);
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
            const formReady = document.querySelector('.sd-question, .sv-question, .sd-element');
            if (!formReady) { updateStatus('Menunggu form dimuat...'); await sleep(1500); continue; }
            const pageText = document.body.innerText.toLowerCase();

            if (pageText.includes('riwayat imunisasi rutin balita')) { await isiImunisasiBalita(); } 
            else if (pageText.includes('riwayat imunisasi tetanus')) { await isiTetanusCatin(); } 
            else { await handleSkriningMandiri(data); }
        } catch(e) { 
            sendBotErrorLog("autoContinueForm_Loop", e.message || e);
            updateStatus("Melewati error, mencoba ulang..."); 
        }
        await sleep(2000);
    }
}

/* =========================================================
   DASHBOARD TRACKER (ANTI BOCOR)
========================================================= */
function getNextTarget(){
    try {
        const completed = getCompleted();
        const btns = [...document.querySelectorAll('button')].filter(btn => {
            const txt = (btn.innerText || '').toLowerCase(); return txt.includes('skrining mandiri') || txt.includes('input data') || txt.includes('tambah');
        });

        for(let btn of btns){
            let parent = btn.parentElement;
            for(let i=0; i<6; i++){
                if(!parent) break;
                let txt = (parent.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
                if (txt.length > 10) {
                    let id = txt.substring(0, 35);
                    if(!completed.includes(id)){ return { btn: btn, id: id, title: txt.substring(0, 25) }; }
                    break;
                }
                parent = parent.parentElement;
            }
        }
        return null;
    } catch(e) { return null; }
}

async function mainLoop(data) {
    updateStatus('MENCARI ANTRIAN...');

    while (BOT_RUNNING && location.hostname.includes('sehatindonesiaku')) {
        try {
            let nextItem = null;
            for (let i = 0; i < 3; i++) {
                if(!BOT_RUNNING) break;
                nextItem = getNextTarget(); 
                if (nextItem) break; 
                await sleep(2000);
            }

            if (!BOT_RUNNING) break;

            if (!nextItem) {
                BOT_RUNNING = false;
                clearBOT(); 
                delStore('PASIEN_AKTIF_CIKLAM_CIKLAM');
                
                updateStatus('SELESAI SEMUA TARGET.\nSilakan pilih DEWASA/ANAK.');
                syncUI(); 
                playSound('selesai');
                showToast('Semua antrian skrining selesai! Lanjut Input Dewasa/Anak.', 'success');
                break;
            }

            updateStatus('MEMBUKA TARGET:\n' + nextItem.title.toUpperCase());
            addCompleted(nextItem.id); 
            nextItem.btn.click();

            updateStatus('Mengalihkan halaman form...');
            for(let wait = 0; wait < 15; wait++) {
                if(!BOT_RUNNING) break;
                await sleep(1500);
                if (!location.hostname.includes('sehatindonesiaku')) {
                    break; 
                }
            }

            break; 
        } catch(e) {
            sendBotErrorLog("mainLoop", e.message || e);
            await sleep(2000);
        }
    }
}

/* =========================================================
   UI MODERN & DRAGGABLE
========================================================= */
let LOOP_ACTIVE = false; 

function updateStatus(text){ const el = document.getElementById('bot-status'); if(el) el.innerText = text; }

function stopBOT(){ 
    BOT_RUNNING = false; 
    LOOP_ACTIVE = false; 
    clearBOT(); 
    clearCompleted(); 
    delStore('LAST_USED_NIK'); 
    delStore('PASIEN_AKTIF_CIKLAM_CIKLAM'); 
    delStore('CKG_MODE');
    updateStatus('BOT DIHENTIKAN & NIK DIHAPUS.'); 
    showToast('Proses dibatalkan secara paksa.', 'warning');
    syncUI(); 
}

function syncUI() {
    const data = loadBOT();
    const btnStart = document.getElementById('run-bot');
    const btnNext = document.getElementById('next-bot');
    const inputNik = document.getElementById('nik-bot');
    const estafetWrap = document.getElementById('estafet-wrap');
    const statusEl = document.getElementById('bot-status');

    if (!btnStart || !btnNext || !inputNik || !estafetWrap) return;

    if (data) {
        btnStart.style.display = 'none'; 
        btnNext.style.display = 'block'; 
        estafetWrap.style.display = 'flex';
        inputNik.value = data.nik || ''; 
        inputNik.disabled = true;

        if(!statusEl.innerText.includes('MEMBUKA TARGET') && !statusEl.innerText.includes('MENGIRIM DATA') && !statusEl.innerText.includes('PENGISIAN OTOMATIS')) {
            updateStatus('SIAP. PENGISIAN OTOMATIS BERJALAN');
        }
    } else {
        btnStart.style.display = 'block'; 
        btnNext.style.display = 'none'; 

        // PRIORITAS BACA ESTAFET (LOCALSTORAGE SAJA)
        let estafetRaw = getStore('PASIEN_AKTIF_CIKLAM_CIKLAM');
        let estafetNik = '';
        if (estafetRaw) {
            try { estafetNik = JSON.parse(estafetRaw).nik || ''; } catch(e){}
        }

        let lastNik = getStore('LAST_USED_NIK') || '';
        let activeNik = estafetNik || lastNik;

        if (activeNik) {
            estafetWrap.style.display = 'flex';
            if (inputNik.value === '') inputNik.value = activeNik; 
            inputNik.disabled = false;
        } else {
            estafetWrap.style.display = 'none'; 
            inputNik.value = ''; 
            inputNik.disabled = false; 

            if(statusEl && !statusEl.innerText.includes('DIHENTIKAN') && !statusEl.innerText.includes('SELESAI')) {
                updateStatus('INISIALISASI...');
            }
        }
    }
}

function createUI(){
    if(document.getElementById('auto-ckg-ui')) return;
    const box = document.createElement('div'); box.id = 'auto-ckg-ui';
    box.innerHTML = `
        <div id="drag-handle" title="Klik dan tahan untuk memindahkan kotak">SKRINING PADASUKA</div>
        <div id="bot-status">INISIALISASI...</div>
        <input id="nik-bot" placeholder="Masukkan 16 Digit NIK...">
        <div id="btn-wrap">
            <button id="run-bot">▶ START SKRINING</button>
            <button id="next-bot" style="display:none; background:#f59e0b; color:#000;">⏩ PAKSA LANJUT</button>
            <button id="stop-bot">🛑 BATAL</button>
        </div>
        <div id="estafet-wrap" style="display:none; gap:8px; margin-top:12px; border-top:1px solid #333; padding-top:12px;">
            <button id="btn-to-input" style="flex:1; background:#10b981; color:#fff; border:none; padding:10px; border-radius:8px; cursor:pointer; font-weight:bold; transition:0.2s; box-shadow:0 2px 5px rgba(0,0,0,0.5);" title="Beralih ke Input Dewasa">DEWASA ⏭️</button>
            <button id="btn-to-anak" style="flex:1; background:#eab308; color:#fff; border:none; padding:10px; border-radius:8px; cursor:pointer; font-weight:bold; transition:0.2s; box-shadow:0 2px 5px rgba(0,0,0,0.5);" title="Beralih ke Input Anak">ANAK ⏭️</button>
        </div>
    `;
    const style = document.createElement('style');
    style.innerHTML = `
        #auto-ckg-ui { position: fixed; top: 100px; right: 20px; width: 300px; background: rgba(15, 15, 15, 0.95); backdrop-filter: blur(15px); border: 1px solid rgba(0, 200, 255, 0.5); border-radius: 16px; z-index: 2147483647; padding: 15px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); font-family: 'Segoe UI', sans-serif; color: white; cursor: default; }
        #drag-handle { padding: 5px; text-align: center; font-weight: bold; color: #00c8ff; cursor: move; margin-bottom: 10px; border-bottom: 1px solid #333; }
        #bot-status { background: rgba(0,0,0,0.4); border-radius: 8px; padding: 10px; min-height: 50px; margin-bottom: 10px; color: #00ff88; font-size: 13px; text-align: center; white-space: pre-wrap; font-weight:bold; border: 1px solid #333; display:flex; align-items:center; justify-content:center;}
        #nik-bot { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #00c8ff; border-radius: 8px; background: #000; color: #00ff88; margin-bottom: 10px; text-align:center; font-weight:bold; outline:none;}
        #nik-bot:disabled { border-color: #555; color: #888; }
        #btn-wrap { display: flex; gap: 8px; }
        #run-bot, #stop-bot, #next-bot { flex: 1; border: none; padding: 10px; border-radius: 8px; font-weight: bold; cursor: pointer; transition: 0.2s; box-shadow:0 2px 5px rgba(0,0,0,0.5); }
        #run-bot { background: #00c8ff; color: #000; } #run-bot:hover { background: #009acc; }
        #stop-bot { background: #ff4444; color: white; } #stop-bot:hover { background: #cc0000; }
        #btn-to-input:hover { background: #059669; } #btn-to-anak:hover { background: #ca8a04; }
    `;
    document.head.appendChild(style); document.body.appendChild(box);

    const handle = document.getElementById('drag-handle');
    if(handle){
        let isDragging = false, offsetX, offsetY;
        handle.onmousedown = (e)=>{ isDragging = true; offsetX = e.clientX - box.offsetLeft; offsetY = e.clientY - box.offsetTop; box.style.opacity = '0.8'; };
        document.onmousemove = (e)=>{ if(isDragging){ box.style.left = (e.clientX - offsetX) + 'px'; box.style.top = (e.clientY - offsetY) + 'px'; box.style.right = 'auto'; } };
        document.onmouseup = ()=>{ isDragging = false; box.style.opacity = '1'; };
    }

    document.getElementById('run-bot').onclick = async ()=>{
        const nik = document.getElementById('nik-bot').value.replace(/\D/g, '');
        if(!nik || nik.length < 16) {
            showToast("Masukkan 16 digit NIK yang valid!", "warning");
            return;
        }

        updateStatus('MENCARI NIK DI DATABASE LOKAL...');
        let data = await cariData(nik);

        // LOGIKA PENAMBAHAN: Jika data kosong, tawarkan opsi pengisian default ("semua normal")
        if(!data) {
            const lanjutNormal = confirm(`Data NIK ${nik} tidak ditemukan di database!\n\nApakah Anda ingin melanjutkan pengisian dengan mode "SEMUA NORMAL"?\n(Jika Setuju bot akan langsung berjalan)`);
            
            if (lanjutNormal) {
                // Memanipulasi objek data agar berisi default normal
                data = {
                    nik: nik,
                    perkawinan: 'Belum Menikah',
                    merokok: 'tidak',
                    jiwa1: 'Tidak sama sekali',
                    jiwa2: 'Tidak sama sekali',
                    jiwa3: 'Tidak sama sekali',
                    jiwa4: 'Tidak sama sekali'
                };
                showToast("Mode SEMUA NORMAL diaktifkan.", "warning");
            } else {
                showToast("Proses dibatalkan.", "error");
                updateStatus('DIBATALKAN.\nData NIK tidak ditemukan.');
                return; 
            }
        }

        saveBOT(data);
        clearCompleted(); 
        syncUI();
        playSound('sukses');
        showToast("Memulai Antrean Skrining...", "info");
    };

    const btnNextBot = document.getElementById('next-bot');
    if (btnNextBot) {
        btnNextBot.onclick = () => {
            const data = loadBOT();
            if(!data) return;
            BOT_RUNNING = true; updateStatus('⚡ Memaksa eksekusi loop...');
            showToast("Sistem dipaksa untuk melanjutkan form.", "warning");
        };
    }

    document.getElementById('btn-to-input').onclick = () => {
        const nik = document.getElementById('nik-bot').value;
        if(!confirm('Anda yakin ingin pindah ke Modul INPUT DEWASA?')) return;

        stopBOT();
        setStore('PASIEN_AKTIF_CIKLAM_CIKLAM', JSON.stringify({ nik: nik, kategori: 'dewasa' })); 
        setStore('CKG_MODE', 'input');
        
        updateStatus('Beralih ke Input Dewasa...'); 
        showToast("Beralih modul...", "success");
        setTimeout(() => location.reload(), 500); 
    };

    document.getElementById('btn-to-anak').onclick = () => {
        const nik = document.getElementById('nik-bot').value;
        if(!confirm('Anda yakin ingin pindah ke Modul INPUT ANAK?')) return;

        stopBOT();
        setStore('PASIEN_AKTIF_CIKLAM_CIKLAM', JSON.stringify({ nik: nik, kategori: 'anak' })); 
        setStore('CKG_MODE', 'input_anak');
        
        updateStatus('Beralih ke Input Anak...'); 
        showToast("Beralih modul...", "success");
        setTimeout(() => location.reload(), 500); 
    };

    document.getElementById('stop-bot').onclick = () => { 
        stopBOT(); 
    };

    syncUI();
}

/* =========================================================
   SENSOR TANGKAP ESTAFET OTOMATIS & ANTI MACET
========================================================= */
setInterval(createUI, 1000);

let isDownloadingBackground = false;

setInterval(async () => {
    try {
        const isFormPage = location.hostname.includes('form.kemkes.go.id');
        const isMainPage = location.hostname.includes('sehatindonesiaku');
        let data = loadBOT();

        // 1. SENSOR ESTAFET DARI DAFTAR (LANGSUNG AUTO-START TANPA KLIK)
        if (isMainPage && !BOT_RUNNING && !data) {
            let estafetRaw = getStore('PASIEN_AKTIF_CIKLAM_CIKLAM');
            if (estafetRaw) {
                try {
                    const estafet = JSON.parse(estafetRaw);
                    
                    let targetSkrining = (estafet.kategori === 'skrining' || getStore('CKG_MODE') === 'skrining');
                    if (!targetSkrining && estafet.nik && estafet.kategori !== 'dewasa' && estafet.kategori !== 'anak') {
                        targetSkrining = true; 
                    }

                    if (estafet.nik && targetSkrining) {
                        updateStatus('⚡ MENERIMA ESTAFET: ' + estafet.nik + '\nMengunduh data...');
                        
                        if (!cachedSheetData && !isDownloadingBackground) {
                            isDownloadingBackground = true;
                            await cariData('000'); 
                        }
                        
                        // Cari data berdasarkan NIK Estafet
                        let data = await cariData(estafet.nik);
                        
                        // LOGIKA PENAMBAHAN UNTUK ESTAFET
                        if (!data) {
                            const lanjutNormal = confirm(`[Jalur Estafet]\nData NIK ${estafet.nik} tidak ditemukan!\n\nApakah Anda ingin melanjutkan pengisian dengan mode "SEMUA NORMAL"?`);
                            if(lanjutNormal) {
                                data = {
                                    nik: estafet.nik,
                                    perkawinan: 'Belum Menikah',
                                    merokok: 'tidak',
                                    jiwa1: 'Tidak sama sekali',
                                    jiwa2: 'Tidak sama sekali',
                                    jiwa3: 'Tidak sama sekali',
                                    jiwa4: 'Tidak sama sekali'
                                };
                            }
                        }
                        
                        if (data) {
                            saveBOT(data);
                            delStore('PASIEN_AKTIF_CIKLAM'); 
                            delStore('CKG_MODE');
                            playSound('sukses');
                            updateStatus('Data siap! Skrining Otomatis dimulai...');
                            
                            BOT_RUNNING = true;
                            syncUI();
                        } else {
                            delStore('PASIEN_AKTIF_CIKLAM');
                            delStore('CKG_MODE');
                            setStore('LAST_USED_NIK', estafet.nik);
                            updateStatus('❌ Gagal Estafet:\nNIK tidak ditemukan di Sheet!');
                            showToast('Proses dibatalkan pengguna.', 'error');
                            syncUI();
                        }
                    }
                } catch(e) {}
            }
        }

        // 2. AUTO-START JIKA MEMORI DATA SUDAH ADA
        if (data && !BOT_RUNNING) BOT_RUNNING = true;

        // 3. BACKGROUND DOWNLOAD SPREADSHEET
        if (isMainPage && !data && !cachedSheetData && !isDownloadingBackground) {
            isDownloadingBackground = true;
            cariData('000').then(() => { 
                const statusEl = document.getElementById('bot-status');
                if (!BOT_RUNNING && statusEl && !statusEl.innerText.includes('SELESAI') && !statusEl.innerText.includes('GAGAL')) {
                    updateStatus('Database Siap !\nSilakan masukkan NIK dan klik START'); 
                }
            }).catch(e => { isDownloadingBackground = false; });
        }

        // 4. ROUTER LOOP (PENENTU JALUR EKSEKUSI)
        if (BOT_RUNNING && data && !LOOP_ACTIVE) {
            if (isFormPage) {
                LOOP_ACTIVE = true; await autoContinueForm(); LOOP_ACTIVE = false; 
            } 
            else if (isMainPage) {
                LOOP_ACTIVE = true; await mainLoop(data); LOOP_ACTIVE = false;
            }
        }
    } catch(e) {
        sendBotErrorLog("Interval_Supervisor", e.message || e);
    }
}, 2000);
})(typeof GM_xmlhttpRequest !== "undefined" ? GM_xmlhttpRequest : null);
