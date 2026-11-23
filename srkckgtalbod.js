(function (GM_xmlhttpRequest) {
    'use strict';
    const request = GM_xmlhttpRequest;

    // Bersihkan instance lama jika script disuntikkan ulang pada tab yang sama
    if (typeof window.__CKG_SKRINING_CLEANUP__ === 'function') {
        try { window.__CKG_SKRINING_CLEANUP__(); } catch (e) { }
    }

    /* =========================================================
       [EXPERT FEATURE] 1. SISTEM TELEMETRI & ERROR LOGGING
    ========================================================= */
    function sendBotErrorLog(context, errorMessage) {
        try {
            if (!request) return;
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
                url: "https://firestore.googleapis.com/v1/projects/jadwal-daily-pkm-padasuka/databases/(default)/documents/Customer/Talbod/error_logs",
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify(payload)
            });
        } catch (e) { }
    }

    /* =========================================================
       [EXPERT FEATURE] 2. TOAST NOTIFICATION (NON-BLOCKING UI)
    ========================================================= */
    function showToast(message, type = 'info') {
        const toastId = 'ckg-toast-container';
        let container = document.getElementById(toastId);
        if (!container && document.body) {
            container = document.createElement('div');
            container.id = toastId;
            container.style = "position:fixed; top:20px; right:20px; z-index:999999; display:flex; flex-direction:column; gap:10px; pointer-events:none;";
            document.body.appendChild(container);
        }
        if (!container) return;

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
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    function normalizeNIK(v) { return String(v || '').replace(/\D/g, ''); }

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
        } catch (e) { }
    }

    /* =========================================================
       CONFIG SPREADSHEET
    ========================================================= */
    const SHEET_ID = '1oj8ES4u6L6odKIy2639u9EtG2OwYr5vvQFaY3YH4dXQ';
    const GIDS = ['0'];

    /* =========================================================
       HELPER MAPPING JAWABAN MEROKOK & EKSTRAK NIK
    ========================================================= */
    function jawabanMerokok(v) {
        const text = String(v || '').toLowerCase().trim();
        return (text.includes('ya') || text.includes('rokok') || text.includes('perokok')) ? 'ya' : 'tidak';
    }

    function parseInfoDariNIK(nik) {
        const clean = normalizeNIK(nik);
        if (clean.length !== 16) return null;

        let tgl = parseInt(clean.substring(6, 8), 10);
        const bln = parseInt(clean.substring(8, 10), 10);
        const thn2 = parseInt(clean.substring(10, 12), 10);

        if (isNaN(tgl) || isNaN(bln) || isNaN(thn2)) return null;

        let jenisKelamin = 'Laki-Laki';
        if (tgl > 40) {
            jenisKelamin = 'Perempuan';
            tgl -= 40;
        }

        const today = new Date();
        const currentYear = today.getFullYear();
        const current2DigitYear = currentYear % 100;

        let tahunLahir = (thn2 > current2DigitYear) ? (1900 + thn2) : (2000 + thn2);
        if (tahunLahir === currentYear) {
            const belumUltah = (today.getMonth() + 1 < bln) || ((today.getMonth() + 1 === bln) && today.getDate() < tgl);
            if (belumUltah) tahunLahir -= 100;
        }

        let usia = currentYear - tahunLahir;
        const selisihBulan = (today.getMonth() + 1) - bln;
        if (selisihBulan < 0 || (selisihBulan === 0 && today.getDate() < tgl)) {
            usia--;
        }

        return { usia, jenisKelamin };
    }

    /* =========================================================
       CROSS-DOMAIN & CROSS-TAB MEMORY
       Mendukung: GM_getValue -> window.name -> localStorage -> postMessage
    ========================================================= */
    const WIN_NAME_PREFIX = 'CKG_BRIDGE:';
    const STORE_KEYS = [
        'AUTO_SKRINING_DATA',
        'AUTO_SKRINING_COMPLETED',
        'LAST_USED_NIK',
        'PASIEN_AKTIF_TALBOD',
        'CKG_MODE',
        'CKG_FORM_LOCK',
        'CKG_ACTIVE_SESSION'
    ];

    function getWinStoreObj() {
        try {
            if (window.name && window.name.startsWith(WIN_NAME_PREFIX)) {
                return JSON.parse(window.name.slice(WIN_NAME_PREFIX.length)) || {};
            }
        } catch (e) { }
        return {};
    }

    function saveWinStoreObj(obj) {
        try {
            window.name = WIN_NAME_PREFIX + JSON.stringify(obj);
        } catch (e) { }
    }

    function getStore(key) {
        try {
            if (typeof GM_getValue !== 'undefined') {
                const gmVal = GM_getValue(key, null);
                if (gmVal !== null && gmVal !== undefined) return gmVal;
            }
        } catch (e) { }

        const winObj = getWinStoreObj();
        if (winObj[key] !== undefined && winObj[key] !== null) {
            try { localStorage.setItem(key, winObj[key]); } catch (e) { }
            return winObj[key];
        }

        try {
            return localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    function setStore(key, value) {
        try {
            if (typeof GM_setValue !== 'undefined') GM_setValue(key, value);
        } catch (e) { }

        const winObj = getWinStoreObj();
        winObj[key] = value;
        saveWinStoreObj(winObj);

        try {
            localStorage.setItem(key, value);
        } catch (e) { }
    }

    function delStore(key) {
        try {
            if (typeof GM_deleteValue !== 'undefined') GM_deleteValue(key);
        } catch (e) { }

        const winObj = getWinStoreObj();
        delete winObj[key];
        saveWinStoreObj(winObj);

        try {
            localStorage.removeItem(key);
        } catch (e) { }
    }

    // Jembatan komunikasi jika form.kemkes.go.id terbuka di TAB BARU (window.opener)
    function onWindowMessage(event) {
        try {
            if (!event.data || typeof event.data !== 'object') return;

            if (event.data.type === 'CKG_REQUEST_STATE') {
                const bundle = {};
                STORE_KEYS.forEach(k => {
                    const v = getStore(k);
                    if (v !== null && v !== undefined) bundle[k] = v;
                });
                if (event.source) {
                    event.source.postMessage({ type: 'CKG_SYNC_STATE', bundle }, '*');
                }
            } else if (event.data.type === 'CKG_SYNC_STATE' && event.data.bundle) {
                Object.entries(event.data.bundle).forEach(([k, v]) => setStore(k, v));
                const data = loadBOT();
                const isSessionActive = getStore('CKG_ACTIVE_SESSION') === '1';
                if (data && isSessionActive) {
                    BOT_RUNNING = true;
                }
                createUI();
                syncUI();
            }
        } catch (e) { }
    }
    window.addEventListener('message', onWindowMessage);

    function requestStateFromOpener() {
        try {
            if (window.opener && !window.opener.closed) {
                window.opener.postMessage({ type: 'CKG_REQUEST_STATE' }, '*');
            }
        } catch (e) { }
    }

    function saveBOT(data) {
        setStore('AUTO_SKRINING_DATA', JSON.stringify(data));
        setStore('LAST_USED_NIK', data.nik);
    }

    function loadBOT() {
        const raw = getStore('AUTO_SKRINING_DATA');
        if (!raw) return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    function clearBOT() { delStore('AUTO_SKRINING_DATA'); }

    function getCompleted() {
        try { return JSON.parse(getStore('AUTO_SKRINING_COMPLETED') || '[]'); } catch (e) { return []; }
    }

    function addCompleted(id) {
        const arr = getCompleted();
        if (!arr.includes(id)) arr.push(id);
        setStore('AUTO_SKRINING_COMPLETED', JSON.stringify(arr));
    }

    function clearCompleted() { delStore('AUTO_SKRINING_COMPLETED'); }

    /* =========================================================
       KONTROL VISIBILITAS UI (HANYA SEMBUNYI SAAT PINDAH KE BOT INPUT/REG/ANAK)
    ========================================================= */
    const OTHER_BOT_MODES = new Set(['input', 'input_anak', 'dewasa', 'anak', 'reg', 'registrasi', 'pendaftaran']);
    let SKRINING_DISMISSED = false;

    function destroyUI() {
        const box = document.getElementById('auto-ckg-ui');
        if (box) box.remove();
        const style = document.getElementById('auto-ckg-style');
        if (style) style.remove();
    }

    function dismissSkriningForOtherBot() {
        SKRINING_DISMISSED = true;
        BOT_RUNNING = false;
        LOOP_ACTIVE = false;
        destroyUI();
    }

    // Pantau jika ada bot lain (Input Dewasa / Anak / Reg) yang dipanggil di tab yang sama
    const bodyChildObserver = new MutationObserver((mutations) => {
        if (location.hostname.includes('form.kemkes.go.id')) return;

        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (!node || node.nodeType !== 1) continue;
                if (node.id === 'auto-ckg-ui' || node.id === 'ckg-toast-container') continue;

                const txt = (node.innerText || '').toUpperCase();
                if (
                    txt.includes('INPUT DEWASA') ||
                    txt.includes('INPUT ANAK') ||
                    txt.includes('BOT INPUT') ||
                    txt.includes('BOT ANAK') ||
                    txt.includes('BOT REG') ||
                    txt.includes('REGISTRASI CKG') ||
                    txt.includes('PENDAFTARAN CKG')
                ) {
                    dismissSkriningForOtherBot();
                    return;
                }
            }
        }
    });

    if (document.body) {
        bodyChildObserver.observe(document.body, { childList: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            if (document.body) bodyChildObserver.observe(document.body, { childList: true });
        });
    }

    // Pantau perubahan localStorage jika Bot Input/Reg/Anak menulis mode baru di tab ini
    try {
        const origSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            origSetItem.apply(this, arguments);
            try {
                if (this === window.localStorage && !location.hostname.includes('form.kemkes.go.id')) {
                    if (key === 'CKG_MODE') {
                        const modeVal = String(value || '').toLowerCase().trim();
                        if (OTHER_BOT_MODES.has(modeVal)) {
                            dismissSkriningForOtherBot();
                        } else if (modeVal === 'skrining') {
                            SKRINING_DISMISSED = false;
                        }
                    } else if (key === 'PASIEN_AKTIF_TALBOD' && value) {
                        const obj = JSON.parse(value);
                        const kat = String((obj && obj.kategori) || '').toLowerCase().trim();
                        if (OTHER_BOT_MODES.has(kat)) {
                            dismissSkriningForOtherBot();
                        } else if (kat === 'skrining') {
                            SKRINING_DISMISSED = false;
                        }
                    }
                }
            } catch (e) { }
        };
    } catch (e) { }

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
        } catch (e) { return false; }
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
        } catch (e) { return null; }
    }

    async function cariData(nikInput) {
        try {
            const target = normalizeNIK(nikInput);
            if (!cachedSheetData || cachedSheetData.length === 0) {
                let savedCache = null; let cacheTime = 0;
                const EXPIRATION_TIME = 4 * 60 * 60 * 1000;
                const now = Date.now();

                try { savedCache = await getCacheDB('CKG_SHEET_DATA'); cacheTime = await getCacheDB('CKG_SHEET_TIME') || 0; } catch (e) { }

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
                        } catch (fetchErr) {
                            console.error("[CARI DATA] Error fetch GID:", gid, fetchErr);
                        }
                    }
                    try {
                        await setCacheDB('CKG_SHEET_DATA', cachedSheetData); await setCacheDB('CKG_SHEET_TIME', now);
                    } catch (e) { }
                }
            }

            if (!cachedSheetData || cachedSheetData.length < 2) return null;

            for (let i = 1; i < cachedSheetData.length; i++) {
                const row = cachedSheetData[i];
                if (!row || row.length < 12) continue;
                const nikSheet = normalizeNIK(row[11]);
                if (nikSheet === target) {
                    return {
                        nik: target, perkawinan: row[26] || 'Belum Menikah', merokok: (row[68] || '').trim(),
                        jiwa1: (row[69] || '').trim(), jiwa2: (row[70] || '').trim(), jiwa3: (row[71] || '').trim(), jiwa4: (row[72] || '').trim()
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
       DOM INTERACTOR (SURVEYJS SAFE & ROBUST)
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
        } catch (e) { }
    }

    function clickSurveyRadioItem(itemEl) {
        if (!itemEl) return false;
        try {
            const input = itemEl.querySelector('input[type="radio"]');
            if (input && input.checked) return true;

            itemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const decorator = itemEl.querySelector('.sd-radio__decorator, .sd-item__decorator, .sv-item__decorator');
            const label = itemEl.querySelector('label, .sd-item__control-label, .sv-item__control-label');

            if (decorator) decorator.click();
            else if (label) label.click();
            else itemEl.click();

            if (input && !input.checked) {
                input.click();
                input.checked = true;
                input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    function getAllQuestionBlocks() {
        return [...document.querySelectorAll('.sd-question, .sv-question, .sd-element[data-name]')].filter(q => q.offsetParent !== null);
    }

    function getQuestionTitleText(q) {
        const header = q.querySelector('.sd-question__title, .sv-question__title, .sd-element__title, h5, h4, h3');
        return ((header ? header.innerText : q.innerText) || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    async function pilihRadioSpesifik(dataName, titleKeywords, optionValue, optionLabel) {
        try {
            let targetQ = dataName ? document.querySelector(`.sd-question[data-name="${dataName}"], .sd-element[data-name="${dataName}"]`) : null;
            if (!targetQ) {
                const questions = getAllQuestionBlocks();
                targetQ = questions.find(q => {
                    const txt = getQuestionTitleText(q);
                    return titleKeywords.some(k => txt.includes(k.toLowerCase()));
                });
            }
            if (!targetQ) return false;

            const items = [...targetQ.querySelectorAll('.sd-item, .sv-item')];
            const targetItem = items.find(el => {
                const input = el.querySelector('input[type="radio"]');
                if (input && optionValue && input.value === optionValue) return true;
                const txt = (el.innerText || '').toLowerCase().replace(/\s+/g, ' ').trim();
                return txt === optionLabel.toLowerCase().trim() || txt.includes(optionLabel.toLowerCase().trim());
            });

            if (targetItem) {
                const ok = clickSurveyRadioItem(targetItem);
                await sleep(350);
                return ok;
            }
        } catch (e) { }
        return false;
    }

    async function fillRadioSurveyJS(soalText, jawabanText, fillAllMatching = false) {
        try {
            const aliases = {
                'status perkawinan': ['status perkawinan', 'perkawinan', 'status nikah'],
                'faktor risiko tb': ['faktor risiko tb', 'tuberkulosis', 'tb', 'batuk', 'demam', 'berkeringat malam', 'berat badan turun', 'kontak erat', 'kontak dengan penderita', 'kontak serumah'],
                'kesehatan jiwa': ['depresi', 'cemas', 'merasa sedih', 'minat melakukan aktivitas'],
                'kanker leher rahim': ['kanker leher rahim', 'serviks', 'pap smear', 'iva', 'hubungan seksual', 'sudah menikah'],
                'gejala kanker paru': ['batuk dalam jangka waktu yang lama', 'batuk berdarah', 'sesak napas', 'nyeri dada', 'leher bengkak', 'benjolan pada leher', 'tidak sembuh-sembuh'],
                'sedang hamil': ['sedang hamil', 'hamil saat ini'],
                'disabilitas': ['disabilitas', 'penyandang disabilitas']
            };
            const keywords = aliases[soalText.toLowerCase()] || [soalText];
            const questions = getAllQuestionBlocks();
            let filledCount = 0;

            for (const targetQ of questions) {
                const qTitle = getQuestionTitleText(targetQ);
                const qFull = (targetQ.innerText || '').toLowerCase();
                const isMatch = keywords.some(k => qTitle.includes(k.toLowerCase()) || qFull.includes(k.toLowerCase()));
                if (!isMatch) continue;

                const items = [...targetQ.querySelectorAll('.sd-item, .sv-item')];
                if (items.length === 0) continue;

                const alreadyChecked = items.some(el => {
                    const inp = el.querySelector('input[type="radio"]');
                    return inp && inp.checked;
                });
                if (alreadyChecked && fillAllMatching) continue;

                const targetNorm = jawabanText.toLowerCase().trim();
                const targetItem = items.find(el => {
                    const txt = (el.innerText || '').toLowerCase().replace(/\s+/g, ' ').trim();
                    if (targetNorm === 'menikah' && txt.includes('belum menikah')) return false;
                    if (targetNorm === 'ya' && txt.startsWith('tidak')) return false;
                    return txt === targetNorm || txt.includes(targetNorm);
                });

                if (targetItem) {
                    if (clickSurveyRadioItem(targetItem)) {
                        filledCount++;
                        await sleep(350);
                        if (!fillAllMatching) return true;
                    }
                }
            }
            return filledCount > 0;
        } catch (e) { }
        return false;
    }

    async function selectDropdownContext(soalText, optionText, typeChar = 't') {
        try {
            const questions = getAllQuestionBlocks();
            const targetQ = questions.find(q => {
                const qText = (q.innerText || '').toLowerCase();
                return qText.includes(soalText.toLowerCase()) || soalText.toLowerCase().includes(qText);
            });

            if (!targetQ) return false;
            const dropdown = targetQ.querySelector('.sd-dropdown, .sv-dropdown');
            if (!dropdown) return false;

            dropdown.scrollIntoView({ behavior: 'smooth', block: 'center' }); dropdown.click(); await sleep(800);

            const search = document.querySelector('input[type="text"][role="combobox"], input[aria-expanded="true"]');
            if (search && typeChar) {
                search.focus(); search.value = typeChar;
                search.dispatchEvent(new Event('input', { bubbles: true })); search.dispatchEvent(new Event('change', { bubbles: true }));
                await sleep(800);
            }

            const opts = [...document.querySelectorAll('.sv-list__item-body, .sd-list__item-body, .sv-list__item, .sd-list__item')].filter(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });
            const targetOpt = opts.find(el => (el.innerText || '').toLowerCase().includes(optionText.toLowerCase()));

            if (targetOpt) {
                targetOpt.click();
                await sleep(400);
                if (document.activeElement) document.activeElement.blur();
                return true;
            }
            dropdown.click();
        } catch (e) { }
        return false;
    }

    async function isiKesehatanJiwa(data) {
        try {
            const j1 = data.jiwa1 || ''; const j2 = data.jiwa2 || ''; const j3 = data.jiwa3 || ''; const j4 = data.jiwa4 || '';
            const semuaPertanyaan = getAllQuestionBlocks();

            for (const q of semuaPertanyaan) {
                if (!BOT_RUNNING) break;
                const text = (q.innerText || '').toLowerCase(); let jawabanSheet = '';

                if (text.includes('bersemangat') || text.includes('minat atau kesenangan')) jawabanSheet = j1 || 'tidak';
                else if (text.includes('murung') || text.includes('putus asa') || text.includes('tertekan')) jawabanSheet = j2 || 'tidak';
                else if (text.includes('gugup') || text.includes('cemas') || text.includes('tegang')) jawabanSheet = j3 || 'tidak';
                else if (text.includes('khawatir') || text.includes('mengendalikan')) jawabanSheet = j4 || 'tidak';

                if (jawabanSheet.trim() !== '') {
                    let kataKunci = ''; const teksJawaban = jawabanSheet.toLowerCase();
                    if (teksJawaban.includes('tidak')) kataKunci = 'tidak';
                    else if (teksJawaban.includes('kurang')) kataKunci = 'kurang';
                    else if (teksJawaban.includes('lebih')) kataKunci = 'lebih';
                    else if (teksJawaban.includes('hampir')) kataKunci = 'hampir';

                    if (kataKunci !== '') {
                        const pilihan = [...q.querySelectorAll('.sd-item, .sv-item')];
                        const targetPilihan = pilihan.find(el => (el.innerText || '').toLowerCase().includes(kataKunci));

                        if (targetPilihan) {
                            clickSurveyRadioItem(targetPilihan);
                            await sleep(400);
                        }
                    }
                }
            }
        } catch (e) { }
    }

    async function isiTetanusCatin() {
        try {
            const judul = document.body.innerText.toLowerCase();
            if (!judul.includes('riwayat imunisasi tetanus')) return false;

            updateStatus('Mengisi Imunisasi Tetanus Catin...');

            const targetKeywords = [
                'pernah imunisasi tetanus tetapi tidak ingat berapa kali',
                'tidak ingat berapa kali'
            ];

            const items = [...document.querySelectorAll('.sd-item, .sv-item')];
            const targetItem = items.find(el => {
                const txt = (el.innerText || '').toLowerCase().replace(/\s+/g, ' ').trim();
                return targetKeywords.some(k => txt.includes(k));
            });

            let berhasilPilih = false;

            if (targetItem) {
                berhasilPilih = clickSurveyRadioItem(targetItem);
                await sleep(250);
            } else {
                berhasilPilih = await selectDropdownContext(
                    'pernah mendapatkan imunisasi tetanus',
                    'pernah imunisasi tetanus tetapi tidak ingat berapa kali'
                );
            }

            if (!berhasilPilih) {
                updateStatus('Menunggu opsi Tetanus Catin muncul...');
                return false;
            }

            await sleep(800);

            if (!BOT_RUNNING) return false;
            const btnKirim = document.querySelector('.sd-navigation__complete-btn') ||
                [...document.querySelectorAll('button, input[type="button"]')].find(el =>
                    (el.value || el.innerText || '').toLowerCase().match(/kirim|lanjut/)
                );

            if (btnKirim) {
                delStore('CKG_FORM_LOCK');
                btnKirim.click();
                await sleep(3000);
            }
            return true;
        } catch (e) {
            sendBotErrorLog("isiTetanusCatin", e.message || e);
            return false;
        }
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
                    if (!BOT_RUNNING) break;
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
                                clickSurveyRadioItem(item);
                                break;
                            }
                        }
                    }
                    await sleep(900);
                }
                jumlahSoalTerjawab = semuaSoal.length;
            }
            await sleep(800);

            if (!BOT_RUNNING) return false;
            const btnKirim = document.querySelector('.sd-navigation__complete-btn') || [...document.querySelectorAll('button,input[type="button"]')].find(b => (b.innerText || '').toLowerCase().match(/lanjut|kirim/));
            if (btnKirim) {
                if ((btnKirim.innerText || btnKirim.value || '').toLowerCase().includes('kirim')) delStore('CKG_FORM_LOCK');
                btnKirim.click();
                await sleep(3500);
            }
            return true;
        } catch (e) { return false; }
    }

    /* =========================================================
       CORE LOGIC SKRINING MANDIRI
    ========================================================= */
    async function handleSkriningMandiri(data) {
        try {
            const pageText = document.body.innerText.toLowerCase();

            if (pageText.includes('terima kasih telah mengisi') || pageText.includes('skrining berhasil')) {
                delStore('CKG_FORM_LOCK');
                updateStatus('Form Selesai! Kembali ke daftar...');
                return;
            }

            if (pageText.includes('status perkawinan') && BOT_RUNNING) {
                updateStatus('Status di Sheet: ' + data.perkawinan);
                if (data.perkawinan && data.perkawinan !== 'Data Kosong') {
                    let p = data.perkawinan.toLowerCase(); let target = 'Menikah';
                    if (p.includes('belum')) target = 'Belum Menikah';
                    else if (p.includes('janda') || p.includes('duda') || p.includes('cerai')) target = 'Cerai Hidup';
                    updateStatus('Mengisi: ' + target);
                    await fillRadioSurveyJS('status perkawinan', target, false);
                } else {
                    await fillRadioSurveyJS('status perkawinan', 'Belum Menikah', false);
                }
            }

            if (pageText.includes('sedang hamil') && BOT_RUNNING) {
                await fillRadioSurveyJS('sedang hamil', 'tidak', true);
            }

            if ((pageText.includes('faktor risiko tb') || pageText.includes('tuberkulosis') || pageText.includes('batuk')) && BOT_RUNNING) {
                await fillRadioSurveyJS('faktor risiko tb', 'tidak batuk', true);
                await fillRadioSurveyJS('faktor risiko tb', 'tidak', true);
            }

            if (pageText.includes('disabilitas') && BOT_RUNNING) {
                await fillRadioSurveyJS('disabilitas', 'non disabilitas', true);
                await fillRadioSurveyJS('disabilitas', 'tidak', true);
            }

            if ((pageText.includes('2 minggu terakhir') || pageText.includes('kesehatan jiwa') || pageText.includes('bersemangat') || pageText.includes('murung')) && BOT_RUNNING) {
                await isiKesehatanJiwa(data);
            }

            if ((pageText.includes('kanker leher rahim') || pageText.includes('serviks') || pageText.includes('payudara')) && BOT_RUNNING) {
                let p = (data.perkawinan || '').toLowerCase();
                let isYes = p.includes('menikah') || p.includes('cerai') || (p.includes('kawin') && !p.includes('belum'));
                await fillRadioSurveyJS('kanker leher rahim', isYes ? 'ya' : 'tidak', false);
            }

            // Pertanyaan Skor APCS (Usia & Jenis Kelamin berdasarkan NIK pasien)
            if (pageText.includes('skor apcs') && BOT_RUNNING) {
                const infoNIK = parseInfoDariNIK(data.nik);
                if (infoNIK) {
                    if (pageText.includes('usia - skor apcs')) {
                        let valUsia = 'PPV00000507';
                        let labelUsia = '<50 tahun';
                        if (infoNIK.usia >= 70) {
                            valUsia = 'PPV00000509';
                            labelUsia = '>= 70 tahun';
                        } else if (infoNIK.usia >= 50) {
                            valUsia = 'PPV00000508';
                            labelUsia = '50 - 69 tahun';
                        }
                        await pilihRadioSpesifik('PPM00000254', ['usia - skor apcs'], valUsia, labelUsia);
                    }

                    if (pageText.includes('jenis kelamin - skor apcs')) {
                        const isPerempuan = infoNIK.jenisKelamin === 'Perempuan';
                        const valJK = isPerempuan ? 'PPV00000511' : 'PPV00000510';
                        const labelJK = isPerempuan ? 'Perempuan' : 'Laki-Laki';
                        await pilihRadioSpesifik('PPM00000255', ['jenis kelamin - skor apcs'], valJK, labelJK);
                    }
                }
            }

            if ((pageText.includes('merokok') || pageText.includes('rokok') || pageText.includes('kanker paru')) && BOT_RUNNING) {
                const statusMerokok = jawabanMerokok(data.merokok);
                const semuaPertanyaan = getAllQuestionBlocks();

                for (const q of semuaPertanyaan) {
                    if (!BOT_RUNNING) break;
                    const text = getQuestionTitleText(q);
                    let targetJawaban = '';

                    if (
                        text.includes('setahun terakhir') ||
                        text.includes('15 tahun terakhir') ||
                        text.includes('apakah anda merokok') ||
                        text.includes('status merokok') ||
                        text.includes('pernah merokok') ||
                        text.includes('menghirup asap rokok') ||
                        text.includes('terpapar asap rokok') ||
                        text.includes('perokok pasif')
                    ) {
                        targetJawaban = statusMerokok;
                    } else if (text.includes('jenis rokok apa yang dikonsumsi') || text.includes('jenis rokok')) {
                        targetJawaban = 'konvensional';
                    } else if (
                        text.includes('kanker paru pada keluarga') ||
                        text.includes('batuk dalam jangka waktu') ||
                        text.includes('tbc atau ppok') ||
                        text.includes('riwayat kanker')
                    ) {
                        targetJawaban = 'tidak';
                    }

                    if (targetJawaban !== '') {
                        const pilihan = [...q.querySelectorAll('.sd-item, .sv-item')];
                        const targetPilihan = pilihan.find(el => {
                            const optTxt = (el.innerText || '').toLowerCase().trim();
                            if (targetJawaban === 'ya' && optTxt.startsWith('tidak')) return false;
                            return optTxt === targetJawaban || optTxt.includes(targetJawaban);
                        });

                        if (targetPilihan) {
                            clickSurveyRadioItem(targetPilihan);
                            await sleep(300);
                        }
                    }

                    const numInput = q.querySelector('input[type="number"]');
                    if (numInput && !numInput.value) {
                        forceInject(numInput, text.includes('batang') ? '6' : '2');
                        await sleep(250);
                    }
                }
            }

            if ((pageText.includes('aktivitas fisik') || pageText.includes('olahraga') || pageText.includes('aktif secara fisik')) && BOT_RUNNING) {
                updateStatus('Mengisi Aktivitas Fisik...');
                const semuaPertanyaan = getAllQuestionBlocks();

                for (const q of semuaPertanyaan) {
                    if (!BOT_RUNNING) break;
                    const qTitle = getQuestionTitleText(q);
                    if (!qTitle.includes('aktivitas') && !qTitle.includes('olahraga') && !qTitle.includes('fisik') && !qTitle.includes('jalan kaki') && !qTitle.includes('duduk') && !qTitle.includes('hari') && !qTitle.includes('menit')) {
                        continue;
                    }

                    const radioItems = [...q.querySelectorAll('.sd-item, .sv-item')];
                    if (radioItems.length > 0) {
                        const alreadyChecked = radioItems.some(el => {
                            const inp = el.querySelector('input[type="radio"]');
                            return inp && inp.checked;
                        });
                        if (!alreadyChecked) {
                            const optTidak = radioItems.find(el => {
                                const t = (el.innerText || '').toLowerCase().trim();
                                return t === 'tidak' || t.startsWith('tidak');
                            });
                            if (optTidak) {
                                clickSurveyRadioItem(optTidak);
                                await sleep(350);
                            }
                        }
                    }

                    const dropdown = q.querySelector('.sd-dropdown, .sv-dropdown');
                    if (dropdown) {
                        const currVal = (dropdown.innerText || '').toLowerCase().trim();
                        if (currVal !== 'tidak') {
                            dropdown.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            dropdown.click();
                            await sleep(900);

                            const opsiTidak = [...document.querySelectorAll('li.sv-list__item, li.sd-list__item, .sv-list__item-body, .sd-list__item-body')].filter(li => {
                                const rect = li.getBoundingClientRect();
                                return rect.width > 0 && rect.height > 0 && li.innerText.trim().toLowerCase() === 'tidak';
                            });
                            if (opsiTidak[0]) {
                                opsiTidak[0].click();
                                opsiTidak[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                await sleep(400);
                            } else {
                                dropdown.click();
                            }
                        }
                    }

                    const numInputs = [...q.querySelectorAll('input[type="number"]')];
                    for (const inp of numInputs) {
                        if (inp.offsetParent === null) continue;
                        let valToSet = '3';
                        if (qTitle.includes('menit') || qTitle.includes('durasi') || qTitle.includes('lama waktu')) valToSet = '30';
                        else if (qTitle.includes('jam')) valToSet = '1';
                        else if (qTitle.includes('hari')) valToSet = '3';

                        if (!inp.value || inp.value === '0') {
                            forceInject(inp, valToSet);
                            await sleep(300);
                        }
                    }
                }
            }

            // Sapu bersih semua pertanyaan radio lain yang belum terjawab
            const negativePriorities = [
                'tidak batuk',
                'non disabilitas',
                'tidak ada keluhan',
                'tidak ada riwayat',
                'tidak pernah',
                'tidak ada',
                'tidak',
                'normal',
                'tidak benar',
                'tidak tahu'
            ];

            const allQuestions = getAllQuestionBlocks();
            for (const q of allQuestions) {
                if (!BOT_RUNNING) break;

                const items = [...q.querySelectorAll('.sd-item, .sv-item')];
                const radios = [...q.querySelectorAll('input[type="radio"]')];
                if (radios.length === 0 && items.length === 0) continue;

                const isAnswered = radios.some(r => r.checked);
                if (isAnswered) continue;

                const qText = getQuestionTitleText(q);
                if (qText.includes('berapa hari anda aktif secara fisik') || qText.includes('jumlah hari aktif')) continue;

                let matchedItem = null;
                for (const candidate of negativePriorities) {
                    matchedItem = items.find(el => {
                        const txt = (el.innerText || '').toLowerCase().replace(/\s+/g, ' ').trim();
                        return txt === candidate || txt.startsWith(candidate + ' ') || txt.startsWith(candidate + ',');
                    });
                    if (matchedItem) break;
                }

                if (matchedItem) {
                    clickSurveyRadioItem(matchedItem);
                    await sleep(250);
                }
            }

            // Centang checkbox persetujuan jika ada sebelum tombol Kirim/Lanjut
            const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')].filter(cb => cb.offsetParent !== null && !cb.checked);
            for (const cb of checkboxes) {
                const container = cb.closest('.sd-item, .sv-item, label') || cb.parentElement;
                const cbText = (container ? container.innerText : '').toLowerCase();
                if (cbText.includes('setuju') || cbText.includes('benar') || cbText.includes('menyatakan') || cbText.includes('bersedia') || checkboxes.length === 1) {
                    const dec = container ? container.querySelector('.sd-checkbox__decorator, .sd-item__decorator') : null;
                    if (dec) dec.click();
                    else cb.click();
                    cb.checked = true;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                    await sleep(300);
                }
            }

            await sleep(1200);
            if (!BOT_RUNNING) return;

            const btnNext = document.querySelector('.sd-navigation__next-btn, .sd-navigation__complete-btn') || [...document.querySelectorAll('button')].find(b => (b.innerText || '').toLowerCase().match(/lanjut|kirim/));
            if (btnNext) {
                const btnLabel = (btnNext.innerText || btnNext.value || '').toLowerCase();
                if (btnLabel.includes('kirim')) delStore('CKG_FORM_LOCK');
                updateStatus('Mengirim data form...');
                btnNext.click();
                await sleep(3500);
            }
        } catch (e) {
            sendBotErrorLog("handleSkriningMandiri", e.message || e);
        }
    }

    /* =========================================================
       FORM LOOP ROUTER
    ========================================================= */
    let BOT_RUNNING = false;

    window.addEventListener('beforeunload', () => {
        if (location.hostname.includes('form.kemkes.go.id')) {
            delStore('CKG_FORM_LOCK');
        }
    });

    async function autoContinueForm() {
        const data = loadBOT();
        if (!data) return;

        BOT_RUNNING = true;
        SKRINING_DISMISSED = false;
        setStore('CKG_FORM_LOCK', String(Date.now()));
        updateStatus('MEMULAI PENGISIAN FORM...');

        for (let i = 0; i < 10; i++) {
            if (!BOT_RUNNING) return;
            if (document.querySelector('.sd-question, .sv-question, input')) break;
            await sleep(800);
        }
        await sleep(800);

        while (BOT_RUNNING && location.hostname.includes("form.kemkes.go.id")) {
            try {
                createUI();
                const pageText = document.body.innerText.toLowerCase();

                if (pageText.includes('riwayat imunisasi rutin balita')) {
                    await isiImunisasiBalita();
                } else if (pageText.includes('riwayat imunisasi tetanus')) {
                    await isiTetanusCatin();
                } else {
                    await handleSkriningMandiri(data);
                }
            } catch (e) {
                sendBotErrorLog("autoContinueForm_Loop", e.message || e);
                updateStatus("Melewati error, mencoba ulang...");
            }
            await sleep(1500);
        }
    }

    /* =========================================================
       DASHBOARD TRACKER (ANTI BOCOR)
    ========================================================= */
    function getNextTarget() {
        try {
            const completed = getCompleted();
            const btns = [...document.querySelectorAll('button')].filter(btn => {
                const txt = (btn.innerText || '').toLowerCase();
                return txt.includes('skrining mandiri') || txt.includes('input data') || txt.includes('tambah');
            });

            for (let btn of btns) {
                let parent = btn.parentElement;
                for (let i = 0; i < 6; i++) {
                    if (!parent) break;
                    let txt = (parent.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
                    if (txt.length > 10) {
                        let id = txt.substring(0, 35);
                        if (!completed.includes(id)) { return { btn: btn, id: id, title: txt.substring(0, 25) }; }
                        break;
                    }
                    parent = parent.parentElement;
                }
            }
            return null;
        } catch (e) { return null; }
    }

    async function mainLoop(data) {
        updateStatus('MENCARI ANTRIAN...');

        while (BOT_RUNNING && !SKRINING_DISMISSED && location.hostname.includes('sehatindonesiaku')) {
            try {
                createUI();
                const lockTime = parseInt(getStore('CKG_FORM_LOCK') || '0', 10);
                if (lockTime && (Date.now() - lockTime < 5000)) {
                    updateStatus('MENUNGGU FORM SELESAI DIISI...');
                    await sleep(1500);
                    continue;
                } else if (lockTime) {
                    delStore('CKG_FORM_LOCK');
                }

                let nextItem = null;
                for (let i = 0; i < 3; i++) {
                    if (!BOT_RUNNING || SKRINING_DISMISSED) break;
                    nextItem = getNextTarget();
                    if (nextItem) break;
                    await sleep(1500);
                }

                if (!BOT_RUNNING || SKRINING_DISMISSED) break;

                if (!nextItem) {
                    BOT_RUNNING = false;
                    clearBOT();
                    delStore('CKG_ACTIVE_SESSION');
                    delStore('PASIEN_AKTIF_TALBOD');
                    delStore('CKG_FORM_LOCK');

                    updateStatus('SELESAI SEMUA TARGET.\nSilakan pilih DEWASA/ANAK.');
                    syncUI();
                    playSound('selesai');
                    showToast('Semua antrian skrining selesai! Lanjut Input Dewasa/Anak.', 'success');
                    break;
                }

                updateStatus('MEMBUKA TARGET:\n' + nextItem.title.toUpperCase());
                addCompleted(nextItem.id);
                setStore('CKG_FORM_LOCK', String(Date.now()));
                nextItem.btn.click();

                updateStatus('Mengalihkan halaman form...');
                for (let wait = 0; wait < 15; wait++) {
                    if (!BOT_RUNNING || SKRINING_DISMISSED) break;
                    await sleep(1500);
                    if (location.hostname.includes('form.kemkes.go.id')) {
                        break;
                    }
                }
                break;
            } catch (e) {
                sendBotErrorLog("mainLoop", e.message || e);
                await sleep(1500);
            }
        }
    }

    /* =========================================================
       UI MODERN & DRAGGABLE
    ========================================================= */
    let LOOP_ACTIVE = false;

    function updateStatus(text) { const el = document.getElementById('bot-status'); if (el) el.innerText = text; }

    function stopBOT() {
        BOT_RUNNING = false;
        LOOP_ACTIVE = false;
        clearBOT();
        clearCompleted();
        delStore('CKG_ACTIVE_SESSION');
        delStore('LAST_USED_NIK');
        delStore('PASIEN_AKTIF_TALBOD');
        delStore('CKG_MODE');
        delStore('CKG_FORM_LOCK');
        updateStatus('BOT DIHENTIKAN & NIK DIHAPUS.');
        showToast('Proses dibatalkan secara paksa.', 'warning');
        syncUI();
    }

    function syncUI() {
        if (SKRINING_DISMISSED && !location.hostname.includes('form.kemkes.go.id')) {
            destroyUI();
            return;
        }

        const data = loadBOT();
        const btnStart = document.getElementById('run-bot');
        const btnNext = document.getElementById('next-bot');
        const inputNik = document.getElementById('nik-bot');
        const estafetWrap = document.getElementById('estafet-wrap');
        const statusEl = document.getElementById('bot-status');

        if (!btnStart || !btnNext || !inputNik || !estafetWrap) return;

        if (data && BOT_RUNNING) {
            btnStart.style.display = 'none';
            btnNext.style.display = 'block';
            estafetWrap.style.display = 'flex';
            inputNik.value = data.nik || '';
            inputNik.disabled = true;

            if (!statusEl.innerText.includes('MEMBUKA TARGET') && !statusEl.innerText.includes('MENGIRIM DATA') && !statusEl.innerText.includes('PENGISIAN')) {
                updateStatus('SIAP. PENGISIAN OTOMATIS BERJALAN');
            }
        } else {
            btnStart.style.display = 'block';
            btnNext.style.display = 'none';

            let estafetRaw = getStore('PASIEN_AKTIF_TALBOD');
            let estafetNik = '';
            if (estafetRaw) {
                try { estafetNik = JSON.parse(estafetRaw).nik || ''; } catch (e) { }
            }

            let lastNik = getStore('LAST_USED_NIK') || '';
            let activeNik = estafetNik || (data && data.nik) || lastNik;

            if (activeNik) {
                estafetWrap.style.display = 'flex';
                if (inputNik.value === '') inputNik.value = activeNik;
                inputNik.disabled = false;
            } else {
                estafetWrap.style.display = 'none';
                inputNik.value = '';
                inputNik.disabled = false;

                if (statusEl && !statusEl.innerText.includes('DIHENTIKAN') && !statusEl.innerText.includes('SELESAI') && !statusEl.innerText.includes('ESTAFET')) {
                    updateStatus('INISIALISASI...');
                }
            }
        }
    }

    function createUI() {
        if (SKRINING_DISMISSED && !location.hostname.includes('form.kemkes.go.id')) {
            destroyUI();
            return;
        }

        if (!document.body || !document.head) return;
        if (document.getElementById('auto-ckg-ui')) return;

        const box = document.createElement('div'); box.id = 'auto-ckg-ui';
        box.innerHTML = `
            <div id="drag-handle" title="Klik dan tahan untuk memindahkan kotak">SKRINING TALAGA BODAS</div>
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
        style.id = 'auto-ckg-style';
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
        if (handle) {
            let isDragging = false, offsetX, offsetY;
            handle.onmousedown = (e) => { isDragging = true; offsetX = e.clientX - box.offsetLeft; offsetY = e.clientY - box.offsetTop; box.style.opacity = '0.8'; };
            document.onmousemove = (e) => { if (isDragging) { box.style.left = (e.clientX - offsetX) + 'px'; box.style.top = (e.clientY - offsetY) + 'px'; box.style.right = 'auto'; } };
            document.onmouseup = () => { isDragging = false; box.style.opacity = '1'; };
        }

        document.getElementById('run-bot').onclick = async () => {
            const nik = document.getElementById('nik-bot').value.replace(/\D/g, '');
            if (!nik || nik.length < 16) {
                showToast("Masukkan 16 digit NIK yang valid!", "warning");
                return;
            }

            updateStatus('MENCARI NIK DI DATABASE LOKAL...');
            let data = await cariData(nik);

            if (!data) {
                const lanjutNormal = confirm(`Data NIK ${nik} tidak ditemukan di database!\n\nApakah Anda ingin melanjutkan pengisian dengan mode "SEMUA NORMAL"?\n(Jika Setuju bot akan langsung berjalan)`);

                if (lanjutNormal) {
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

            SKRINING_DISMISSED = false;
            saveBOT(data);
            clearCompleted();
            delStore('CKG_FORM_LOCK');
            setStore('CKG_MODE', 'skrining');
            setStore('CKG_ACTIVE_SESSION', '1');
            BOT_RUNNING = true;
            syncUI();
            playSound('sukses');
            showToast("Memulai Antrean Skrining...", "info");
        };

        const btnNextBot = document.getElementById('next-bot');
        if (btnNextBot) {
            btnNextBot.onclick = () => {
                const data = loadBOT();
                if (!data) return;
                SKRINING_DISMISSED = false;
                delStore('CKG_FORM_LOCK');
                setStore('CKG_MODE', 'skrining');
                setStore('CKG_ACTIVE_SESSION', '1');
                BOT_RUNNING = true;
                updateStatus('⚡ Memaksa eksekusi loop...');
                showToast("Sistem dipaksa untuk melanjutkan form.", "warning");
            };
        }

        document.getElementById('btn-to-input').onclick = () => {
            const nik = document.getElementById('nik-bot').value;
            if (!confirm('Anda yakin ingin pindah ke Modul INPUT DEWASA?')) return;

            stopBOT();
            setStore('PASIEN_AKTIF_TALBOD', JSON.stringify({ nik: nik, kategori: 'dewasa' }));
            setStore('CKG_MODE', 'input');
            try { sessionStorage.setItem('CKG_SWITCH_TO_INPUT_TS', String(Date.now())); } catch (e) { }
            dismissSkriningForOtherBot();

            showToast("Beralih ke Input Dewasa...", "success");
            setTimeout(() => location.reload(), 400);
        };

        document.getElementById('btn-to-anak').onclick = () => {
            const nik = document.getElementById('nik-bot').value;
            if (!confirm('Anda yakin ingin pindah ke Modul INPUT ANAK?')) return;

            stopBOT();
            setStore('PASIEN_AKTIF_TALBOD', JSON.stringify({ nik: nik, kategori: 'anak' }));
            setStore('CKG_MODE', 'input_anak');
            try { sessionStorage.setItem('CKG_SWITCH_TO_INPUT_TS', String(Date.now())); } catch (e) { }
            dismissSkriningForOtherBot();

            showToast("Beralih ke Input Anak...", "success");
            setTimeout(() => location.reload(), 400);
        };

        document.getElementById('stop-bot').onclick = () => {
            stopBOT();
        };

        syncUI();
    }

    /* =========================================================
       INISIALISASI STANDBY & PENERIMA ESTAFET TANPA AUTO-START
    ========================================================= */
    let isDownloadingBackground = false;

    async function supervisorTick() {
        try {
            const currentHost = window.location.hostname;
            const isFormPage = currentHost.includes('form.kemkes.go.id');
            const isMainPage = currentHost.includes('sehatindonesiaku');

            // Terima estafet dari Bot Input -> aktifkan kembali Bot Skrining (standby, tanpa auto-start)
            if (isMainPage) {
                let estafetRaw = getStore('PASIEN_AKTIF_TALBOD');
                if (estafetRaw) {
                    try {
                        const estafet = JSON.parse(estafetRaw);
                        const kat = (estafet.kategori || '').toLowerCase().trim();

                        let targetSkrining = (kat === 'skrining' || getStore('CKG_MODE') === 'skrining');
                        if (!targetSkrining && estafet.nik && !OTHER_BOT_MODES.has(kat)) {
                            targetSkrining = true;
                        }

                        if (estafet.nik && targetSkrining) {
                            const nikEstafet = normalizeNIK(estafet.nik);

                            SKRINING_DISMISSED = false;
                            BOT_RUNNING = false;
                            LOOP_ACTIVE = false;
                            clearBOT();
                            clearCompleted();
                            delStore('CKG_ACTIVE_SESSION');
                            delStore('CKG_FORM_LOCK');
                            delStore('PASIEN_AKTIF_TALBOD');
                            delStore('CKG_MODE');

                            setStore('LAST_USED_NIK', nikEstafet);
                            createUI();
                            const inputNik = document.getElementById('nik-bot');
                            if (inputNik) inputNik.value = nikEstafet;

                            syncUI();
                            updateStatus('ESTAFET DITERIMA:\n' + nikEstafet + '\nKlik START SKRINING untuk mulai.');
                            showToast('NIK dari Bot Input masuk. Klik START untuk menjalankan.', 'info');
                            return;
                        }
                    } catch (e) { }
                }
            }

            if (SKRINING_DISMISSED && !isFormPage) {
                destroyUI();
                return;
            }

            createUI();

            let data = loadBOT();

            // Jika di halaman form tapi data kosong (tab baru), minta dari tab induk
            if (isFormPage && !data) {
                requestStateFromOpener();
                await sleep(300);
                data = loadBOT();
            }

            if (isMainPage && !data && !cachedSheetData && !isDownloadingBackground) {
                isDownloadingBackground = true;
                cariData('000').then(() => {
                    const statusEl = document.getElementById('bot-status');
                    if (
                        !BOT_RUNNING &&
                        statusEl &&
                        !statusEl.innerText.includes('SELESAI') &&
                        !statusEl.innerText.includes('GAGAL') &&
                        !statusEl.innerText.includes('ESTAFET')
                    ) {
                        updateStatus('Database Siap !\nSilakan masukkan NIK dan klik START');
                    }
                }).catch(() => { isDownloadingBackground = false; });
            }

            if (BOT_RUNNING && data && !LOOP_ACTIVE) {
                if (isFormPage) {
                    LOOP_ACTIVE = true; await autoContinueForm(); LOOP_ACTIVE = false;
                } else if (isMainPage) {
                    LOOP_ACTIVE = true; await mainLoop(data); LOOP_ACTIVE = false;
                }
            }
        } catch (e) {
            sendBotErrorLog("Interval_Supervisor", e.message || e);
        }
    }

    function bootBot() {
        const currentHost = window.location.hostname;
        const isFormPage = currentHost.includes('form.kemkes.go.id');
        const existingData = loadBOT();
        const hasActiveSession = getStore('CKG_ACTIVE_SESSION') === '1';
        const estafetRaw = getStore('PASIEN_AKTIF_TALBOD');

        // Cek apakah halaman baru saja di-reload akibat user mengklik tombol pindah DEWASA / ANAK
        let isFreshSwitchReload = false;
        if (!isFormPage) {
            try {
                const switchTs = parseInt(sessionStorage.getItem('CKG_SWITCH_TO_INPUT_TS') || '0', 10);
                if (switchTs && (Date.now() - switchTs < 15000)) {
                    isFreshSwitchReload = true;
                }
                sessionStorage.removeItem('CKG_SWITCH_TO_INPUT_TS');
            } catch (e) { }
        }

        if (isFreshSwitchReload) {
            dismissSkriningForOtherBot();
            return;
        }

        // Jika di halaman utama dan sudah ada panel Bot Input/Anak/Reg di layar, sembunyikan Skrining
        if (!isFormPage && document.body) {
            const bodyTxt = document.body.innerText.toUpperCase();
            if (
                bodyTxt.includes('INPUT DEWASA') ||
                bodyTxt.includes('INPUT ANAK') ||
                bodyTxt.includes('BOT INPUT') ||
                bodyTxt.includes('BOT ANAK') ||
                bodyTxt.includes('BOT REG')
            ) {
                dismissSkriningForOtherBot();
                return;
            }
        }

        SKRINING_DISMISSED = false;

        if (isFormPage && existingData) {
            BOT_RUNNING = true;
        } else if (!isFormPage && existingData && hasActiveSession && !estafetRaw) {
            BOT_RUNNING = true;
        } else {
            BOT_RUNNING = false;
            if (!hasActiveSession && existingData) {
                clearBOT();
            }
        }

        createUI();
        syncUI();
        supervisorTick();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootBot);
    } else {
        bootBot();
    }

    const uiIntervalId = setInterval(() => {
        if (!SKRINING_DISMISSED || location.hostname.includes('form.kemkes.go.id')) {
            createUI();
        }
    }, 1000);
    const supervisorIntervalId = setInterval(supervisorTick, 1500);

    window.__CKG_SKRINING_CLEANUP__ = function () {
        BOT_RUNNING = false;
        LOOP_ACTIVE = false;
        clearInterval(uiIntervalId);
        clearInterval(supervisorIntervalId);
        bodyChildObserver.disconnect();
        window.removeEventListener('message', onWindowMessage);
        destroyUI();
    };
})(typeof GM_xmlhttpRequest !== "undefined" ? GM_xmlhttpRequest : null);
