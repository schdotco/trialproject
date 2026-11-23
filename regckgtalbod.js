(function (GM_xmlhttpRequest) {
'use strict';
    const request = GM_xmlhttpRequest;

function wait(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

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
                module: { stringValue: "REGISTRATION_BOT" },
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
    toast.style = `background:${bgColors[type] || bgColors.info}; color:#fff; padding:12px 20px; border-radius:8px; box-shadow:0 4px 15px rgba(0,0,0,0.3); font-family:sans-serif; font-size:14px; font-weight:bold; opacity:0; transform:translateX(50px); transition:all 0.3s ease;`;
    toast.innerHTML = message;
    
    container.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(0)'; });
    
    setTimeout(() => {
        toast.style.opacity = '0'; toast.style.transform = 'translateX(50px)';
        setTimeout(() => toast.remove(), 300);
    }, 1500);
}

/* ================= MODUL ESTAFET, AUDIO & DELAY ================= */
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

function getKategoriUmur(tglLahir) {
    if (!tglLahir) return 'dewasa';
    let p = tglLahir.split(/[-/]/);
    let y = p[0].length === 4 ? p[0] : (p[2] || new Date().getFullYear());
    return (new Date().getFullYear() - parseInt(y)) < 18 ? 'anak' : 'dewasa';
}
    
/* ================= MODE CKG UMUM ================= */
const SHEETS = [{
    id: "1zOX229-nq8n0-jCSTMEL1r4CVqW_hYctcpo-5pgjY_E",
    gids: ["484052211"],
    colNama: 5, colTgl: 8, colWA: 23, colJK: 6, colPekerjaan: 12, colKelurahan: 20, colAlamat: 17, colMartial: 13, waStatis: true
}];

let isProcessing = false;
let isCancelled = false; // Flag global untuk membatalkan proses
let loadingEl = null;

/* ================= STORAGE INTERNAL PC (INDEXED DB) ================= */
const DB_NAME = 'CKG_Database_Internal';
const STORE_NAME = 'SheetCache';

function openDB() {
    return new Promise((resolve, reject) => {
        let req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
            let db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) { db.createObjectStore(STORE_NAME); }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveInternalDB(key, data) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            let tx = db.transaction(STORE_NAME, 'readwrite');
            let store = tx.objectStore(STORE_NAME);
            store.put(data, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) { return false; }
}

async function loadInternalDB(key) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            let tx = db.transaction(STORE_NAME, 'readonly');
            let store = tx.objectStore(STORE_NAME);
            let req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null); 
        });
    } catch (e) { return null; }
}
    
/* ================= LOADING SCREEN ================= */
function showLoading(text){
    if(loadingEl) { loadingEl.querySelector('#loadText').innerHTML = text; return; }
    loadingEl = document.createElement("div");
    loadingEl.style = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;color:#00ff88;font-size:20px;font-weight:bold;text-align:center;flex-direction:column;";
    loadingEl.innerHTML = `<div style="background:#111;padding:30px;border-radius:12px;border:3px solid #00ff88;box-shadow:0 0 20px #00ff88;"><span id="loadText">${text}</span><br><br><div style="margin:auto;border:6px solid #333;border-top:6px solid #00ff88;border-radius:50%;width:50px;height:50px;animation:spin 1s linear infinite;"></div></div>`;
    document.body.appendChild(loadingEl);
}
function hideLoading(){ if(loadingEl){ loadingEl.remove(); loadingEl = null; } }
const style = document.createElement('style'); style.innerHTML = `@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`; document.head.appendChild(style);

/* ================= LOGIKA DATA & SAFE CLICK ================= */
const normalizeNIK = v => String(v || "").replace(/\D/g, '');

function sikatReactInput(element, value){
    if(!element) return;
    const setter = Object.getOwnPropertyDescriptor(element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set;
    if(setter){
        setter.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles:true }));
        element.dispatchEvent(new Event('change', { bubbles:true }));
    }
}

function forceInject(element, value) {
    if (!element) return;
    element.removeAttribute('disabled');
    element.removeAttribute('readonly');
    sikatReactInput(element, value);
}

function getInput(keyword){
    const inputs = Array.from(document.querySelectorAll("input, textarea"));
    let target = inputs.find(i => (i.placeholder || "").toLowerCase().includes(keyword.toLowerCase()));
    if(target) return target;
    const labels = Array.from(document.querySelectorAll('.ant-form-item-label label'));
    const label = labels.find(l => l.innerText.toLowerCase().includes(keyword.toLowerCase()));
    if (label) {
        const row = label.closest('.ant-form-item');
        if (row) return row.querySelector('input, textarea');
    }
    return null;
}

async function ultraClick(el){
    if(!el) return false;
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width/2;
    const y = rect.top + rect.height/2;
    el.scrollIntoView({ behavior:'smooth', block:'center' });
    await wait(300);
    ['pointerover','mouseover','mouseenter'].forEach(type=>{
        el.dispatchEvent(new MouseEvent(type,{ bubbles:true, clientX:x, clientY:y }));
    });
    await wait(80);
    el.dispatchEvent(new PointerEvent('pointerdown',{ bubbles:true, pointerType:'mouse', clientX:x, clientY:y, isPrimary:true }));
    el.dispatchEvent(new MouseEvent('mousedown',{ bubbles:true, clientX:x, clientY:y }));
    await wait(120);
    el.dispatchEvent(new PointerEvent('pointerup',{ bubbles:true, pointerType:'mouse', clientX:x, clientY:y, isPrimary:true }));
    el.dispatchEvent(new MouseEvent('mouseup',{ bubbles:true, clientX:x, clientY:y }));
    await wait(50);
    el.click();
    return true;
}

async function prosesVerifikasi() {
    let attempt1 = 0;
    while (!isCancelled && attempt1 < 3) {
        const pilihText = Array.from(document.querySelectorAll('.tracking-wide')).find(el => (el.innerText || "").trim() === "Pilih");
        const pilihBtn = pilihText?.closest('.flex.flex-row.justify-center.gap-2') || pilihText?.parentElement || pilihText;
        if (pilihBtn) { await ultraClick(pilihBtn); break; }
        await wait(500);
        attempt1++;
    }

    let attempt2 = 0;
    while (!isCancelled && attempt2 < 3) {
        const daftarBtn = Array.from(document.querySelectorAll('button')).find(btn => 
            (btn.innerText || "").toLowerCase().includes("daftarkan dengan nik") || 
            (btn.classList.contains('btn-fill-primary-v2') && (btn.innerText || "").toLowerCase().includes("daftarkan"))
        );
        
        if (daftarBtn && daftarBtn.offsetParent !== null) {
            await ultraClick(daftarBtn);
            break;
        }
        await wait(500);
        attempt2++;
    }

    // --- DETEKSI HANYA TOMBOL TUTUP SEBAGAI TANDA SELESAI ---
    let attempt3 = 0;
    while (!isCancelled && attempt3 < 3) { // 4 x 500ms = 2 detik batas tunggu
        const teksTutup = Array.from(document.querySelectorAll('.tracking-wide, div')).find(el => (el.innerText || "").trim() === "Tutup");
        const btnTutup = teksTutup?.closest('button') || teksTutup?.closest('.cursor-pointer') || teksTutup;

        // Jika tombol Tutup muncul, klik dan hentikan proses (selesai)
        if (btnTutup && btnTutup.offsetParent !== null) {
            await ultraClick(btnTutup);
            break; // Selesai sempurna!
        }
        await wait(500);
        attempt3++;
    }
}

/* ================= TARIK DATA SPREADSHEET ================= */
function parseCSV(text){
    const rows = []; let row = []; let current = ""; let insideQuote = false;
    for(let i=0;i<text.length;i++){
        const char = text[i]; const next = text[i+1];
        if(char === '"'){ if(insideQuote && next === '"'){ current += '"'; i++; }else{ insideQuote = !insideQuote; } }
        else if(char === ',' && !insideQuote){ row.push(current); current = ""; }
        else if((char === '\n' || char === '\r') && !insideQuote){ if(current || row.length){ row.push(current); rows.push(row); row = []; current = ""; } }
        else{ current += char; }
    }
    if(current || row.length){ row.push(current); rows.push(row); }
    return rows;
}

let cachedSheetDataList = null;

async function cariData(nikInput) {
    const target = normalizeNIK(nikInput);

    if (!cachedSheetDataList) {
        let savedCache = null;
        let cacheTime = 0;
        const EXPIRATION_TIME = 4 * 60 * 60 * 1000; 
        const now = Date.now();

        const cacheObj = await loadInternalDB('MULTISHEET_DATA');
        if (cacheObj) { savedCache = cacheObj.data; cacheTime = cacheObj.time || 0; }

        if (savedCache && savedCache.length > 0 && (now - cacheTime < EXPIRATION_TIME)) {
            cachedSheetDataList = savedCache;
        } else {
            cachedSheetDataList = [];
            for (let s = 0; s < SHEETS.length; s++) {
                const source = SHEETS[s];
                for (const gid of source.gids) {
                    document.getElementById("infoAI").innerHTML = `<b style="color:#ffcc00;">Mengunduh Database...<br>Mohon tunggu (File Besar)</b>`;
                    const csv = await new Promise(resolve => {
                        request({
                            method: "GET", 
                            url: `https://docs.google.com/spreadsheets/d/${source.id}/export?format=csv&gid=${gid}`,
                            timeout: 60000, 
                            onload: r => resolve(r.responseText || ""), 
                            ontimeout: () => resolve(""),
                            onerror: () => resolve("")
                        });
                    });

                    if (!csv || csv.trim() === "") continue;
                    const rows = parseCSV(csv);
                    const cleanRows = rows.filter(row => row.some(cell => String(cell).trim() !== ''));
                    cachedSheetDataList.push({ sheetIndex: s, rows: cleanRows });
                }
            }
            if (cachedSheetDataList.length > 0) {
                await saveInternalDB('MULTISHEET_DATA', { data: cachedSheetDataList, time: now });
            }
        }
    }

    if (!cachedSheetDataList || cachedSheetDataList.length === 0) return null;

    for (const cacheItem of cachedSheetDataList) {
        const source = SHEETS[cacheItem.sheetIndex]; 
        const rows = cacheItem.rows;
        let waD2 = (source.waStatis && rows[1]) ? normalizeNIK(rows[1][3]) : "";

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (Array.isArray(row) && row.find(col => normalizeNIK(col) === target)) {
                return {
                    nik: target, nama: (row[source.colNama] || "").trim(), tgl: (row[source.colTgl] || "").trim(),
                    hp: waD2 || (row[source.colWA] || "").replace(/\D/g,''), jk: (row[source.colJK] || "").trim(),
                    alamat: (row[source.colAlamat] || "").trim(), pekerjaan: (row[source.colPekerjaan] || "").trim(),
                    kelurahan: (row[source.colKelurahan] || "").trim(), sekolah: (row[source.colSekolah] || "").trim(),
                    disabilitas: (row[source.colDisabilitas] || "").trim(), Martial: (row[source.colMartial] || "").trim(),
                    kelas: (row[source.colKelas] || "").trim()
                };
            }
        }
    }
    return null;
}

/* ================= ENGINE ALAMAT WILAYAH VUE ================= */
async function setAlamatDomisiliVue() {
    if(isCancelled) return false;
    const steps = ["Jawa Barat", "Kota Bandung", "Lengkong", "Malabar"];
    const allElements = Array.from(document.querySelectorAll('div, span'));
    const trigger = allElements.find(el => (el.innerText || "").toLowerCase().trim() === "pilih alamat domisili" && el.children.length === 0);

    if (!trigger) return false;
    await ultraClick(trigger.closest('.cursor-pointer') || trigger);
    await wait(1500); 

    for (const step of steps) {
        if(isCancelled) return false;
        let searchInput = Array.from(document.querySelectorAll('input')).find(el => {
            const p = (el.placeholder || "").toLowerCase();
            return p.includes("cari") && !p.includes("pekerjaan"); 
        });

        if (searchInput) {
            forceInject(searchInput, step);
            await wait(1500); 
        }

        let clicked = false;
        for (let i = 0; i < 15; i++) {
            if(isCancelled) return false;
            const options = Array.from(document.querySelectorAll('div.flex.items-center.justify-between')).filter(el => (el.innerText || "").trim().toLowerCase() === step.toLowerCase());
            if (options.length > 0) {
                await ultraClick(options[options.length - 1]);
                clicked = true;
                await wait(1000);
                break;
            }
            await wait(400);
        }
        if(!clicked) break;
    }
}

/* ================= EKSEKUSI HALAMAN 2 ================= */
async function eksekusiHalamanDua(data) {
    try {
        if(isCancelled) return;
        showLoading("⚡ MENGISI HALAMAN 2... ⚡");
        await wait(1500);

        // --- 1. STATUS PERNIKAHAN ---
        let rawPernikahan = (data.Martial || "").trim().toUpperCase();
        let textToFindPernikahan = "";
        if (rawPernikahan.includes("BELUM")) { textToFindPernikahan = "Belum Menikah"; } 
        else if (rawPernikahan.includes("MENIKAH") || rawPernikahan.includes("KAWIN")) { textToFindPernikahan = "Menikah"; } 
        else if (rawPernikahan.includes("CERAI HIDUP") || rawPernikahan.includes("CERAI_HIDUP") || rawPernikahan.includes("JANDA") || rawPernikahan.includes("DUDA")) { textToFindPernikahan = "Cerai Hidup"; } 
        else if (rawPernikahan.includes("CERAI MATI") || rawPernikahan.includes("CERAI_MATI")) { textToFindPernikahan = "Cerai Mati"; }

        if (textToFindPernikahan !== "" && !isCancelled) {
            const allElements = Array.from(document.querySelectorAll('span, div.cursor-pointer, label'));
            const triggerPernikahan = allElements.find(el => {
                const txt = (el.innerText || "").toLowerCase().trim();
                return txt === 'pilih status pernikahan' || txt === 'status pernikahan';
            });

            if (triggerPernikahan) {
                const clickableTrigger = triggerPernikahan.closest('.cursor-pointer') || triggerPernikahan;
                await ultraClick(clickableTrigger);
                await wait(1000);

                for (let i = 0; i < 15; i++) {
                    if(isCancelled) return;
                    const targetOption = [...document.querySelectorAll('.py-2.px-4.cursor-pointer')].find(el => (el.innerText || '').trim() === textToFindPernikahan);
                    if (targetOption) {
                        await ultraClick(targetOption);
                        await wait(1000);
                        break;
                    }
                    await wait(400);
                }
            }
        }

        // --- 2. PEKERJAAN ---
        let jobTarget = (data.pekerjaan || data.Pekerjaan || "").trim();
        if (jobTarget && !isCancelled) {
            const allElements = Array.from(document.querySelectorAll('div, span'));
            const triggerDiv = allElements.find(el => {
                const txt = (el.innerText || "").toLowerCase().trim(); 
                const rect = el.getBoundingClientRect();
                return txt === "pilih pekerjaan" && el.children.length === 0 && rect.width > 0;
            });

            if (triggerDiv) {
                const clickableArea = triggerDiv.closest('.cursor-pointer') || triggerDiv;
                clickableArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await wait(800);
                await ultraClick(clickableArea);
                await wait(1500); 

                const searchInput = document.querySelector('input[placeholder="Cari pekerjaan"]');
                if (searchInput) {
                    searchInput.focus(); 
                    forceInject(searchInput, jobTarget);
                    searchInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                    await wait(1500); 
                }

                const optionDivs = Array.from(document.querySelectorAll('.modal-content div.flex.items-center.justify-between'));
                for (let el of optionDivs) {
                    if(isCancelled) return;
                    let text = (el.innerText || "").trim().toLowerCase();
                    if (text === jobTarget.toLowerCase() || text.includes(jobTarget.toLowerCase())) {
                        const parentBtn = el.closest('button');
                        if (parentBtn) {
                            parentBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            await wait(500);
                            await ultraClick(parentBtn);
                            await wait(1000); 
                            break; 
                        }
                    }
                }

                let cekModal = 0;
                while(document.querySelector('input[placeholder="Cari pekerjaan"]') && cekModal < 8 && !isCancelled) {
                    const closeBtn = document.querySelector('.modal-content header button');
                    if (closeBtn) await ultraClick(closeBtn);
                    else document.body.click();
                    await wait(500);
                    cekModal++;
                }
            }
        }
        
        await wait(1500);

        // --- 3. ALAMAT DOMISILI ---
        if(!isCancelled) {
            showLoading("⚡ MENCARI WILAYAH Malabar... ⚡");
            await setAlamatDomisiliVue();
            await wait(1500);
        }

        // --- 4. DETAIL DOMISILI ---
        if(!isCancelled) {
            showLoading("⚡ MENYUNTIKKAN DETAIL ALAMAT... ⚡");
            let inpAlamat = document.getElementById('detail-domisili') || document.querySelector('textarea[placeholder*="Jl. Kenanga"]');

            if(inpAlamat){
                inpAlamat.scrollIntoView({ behavior:"smooth", block:"center" });
                await wait(500);
                forceInject(inpAlamat, data.alamat || "-");
                await wait(500);
                inpAlamat.blur();
            }
        }

        hideLoading();

        // --- 5. MENUNGGU NEXT ---
        if(!isCancelled) {
            document.getElementById("infoAI").innerHTML += `<div id="status-wait-next" style="margin-top:8px; padding:6px; background:#222; border-radius:5px; color:#ffcc00;">⏳ Menunggu tombol Daftarkan aktif...</div>`;
            
            while(!isCancelled){
                const btnNext2 = Array.from(document.querySelectorAll("button")).find(btn => {
                    const txt = (btn.innerText || "").trim();
                    return (txt === "Daftarkan" && !btn.disabled && btn.offsetParent !== null);
                });

                if(btnNext2){
                    await ultraClick(btnNext2);
                    await wait(1000);
                    await prosesVerifikasi();
                    break;
                }
                await wait(1000);
            }
        }
        
    } catch (error) {
        sendBotErrorLog("eksekusiHalamanDua", error.message || error);
        hideLoading();
        showToast("Terjadi kendala di Halaman 2.", "warning");
    }
}

/* ================= SISTEM SEMI AUTO-PILOT ================= */
async function autoPilotSikatHabis(data) {
    try {
        isCancelled = false; // Reset status batal tiap kali bot baru berjalan
        document.getElementById("btn-batal-ai").style.display = "block"; // Munculkan tombol batal
        document.getElementById("btn-direct-skrining").style.display = "none"; // Sembunyikan direct sampai sukses

        showLoading("⚡ AUTO-PILOT AKTIF ⚡<br><span style='font-size:14px;color:#fff;'>Mengisi NIK...</span>");

        const btnTambah = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Tambah Baru') || b.innerText.includes('Tambah Peserta'));
        if (btnTambah && !document.querySelector('.ant-modal-content') && !isCancelled) {
            ultraClick(btnTambah);
            await wait(1500);
        }

        if(isCancelled) { handlePembatalan(); return; }

        const inpNIK = getInput("nik");
        if (inpNIK) {
            forceInject(inpNIK, data.nik);
            await wait(300);
            const btnCek = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Cek NIK') || b.innerText.includes('Cari'));
            if (btnCek && !isCancelled) ultraClick(btnCek);
        }

        if(isCancelled) { handlePembatalan(); return; }
        showLoading("⏳ Menunggu Dukcapil Mereset Form...");
        await wait(1000);
        if(isCancelled) { handlePembatalan(); return; }
        showLoading("⚡ MENGISI DATA AWAL... ⚡");

        let inpNama = getInput("nama lengkap");
        if (inpNama) forceInject(inpNama, data.nama);

        let cleanHP = (data.hp || "").replace(/^0/, "");
        let inpWA = getInput("whatsapp") || getInput("telepon");
        if (inpWA) forceInject(inpWA, cleanHP);

        // --- ISI JK ---
        let rawJK = (data.jk || "").trim().toUpperCase();
        let textToFindJK = "";
        if (rawJK.includes("LAKI") || rawJK === "L" || rawJK === "LK") { textToFindJK = "Laki-laki"; } 
        else if (rawJK.includes("PEREM") || rawJK === "P" || rawJK === "PR" || rawJK.includes("WANITA")) { textToFindJK = "Perempuan"; }

        if (textToFindJK !== "" && !isCancelled) {
            const allElements = Array.from(document.querySelectorAll('span, div.cursor-pointer, label'));
            const triggerJK = allElements.find(el => {
                const txt = (el.innerText || "").toLowerCase().trim();
                return txt === 'pilih jenis kelamin' || txt === 'jenis kelamin';
            });

            if (triggerJK) {
                const clickableTrigger = triggerJK.closest('.cursor-pointer') || triggerJK;
                await ultraClick(clickableTrigger);
                await wait(1000); 

                for (let i = 0; i < 15; i++) {
                    if(isCancelled) return;
                    const possibleOptions = Array.from(document.querySelectorAll('*')).filter(el => {
                        return (el.innerText || "").trim() === textToFindJK && el.children.length === 0;
                    });
                    if (possibleOptions.length > 0) {
                        await ultraClick(possibleOptions[possibleOptions.length - 1]);
                        await wait(800);
                        break;
                    }
                    await wait(400); 
                }
            }
        }

        // --- ISI TANGGAL ---
        let tglRaw = data.tgl || "";
        if (tglRaw.trim() !== "" && !isCancelled) {
            let parts = tglRaw.split(/[-/]/);
            if (parts.length === 3) {
                let yyyy, mm, dd;
                if (parts[0].length === 4) { yyyy = parts[0]; mm = parts[1]; dd = parts[2]; }
                else { dd = parts[0]; mm = parts[1]; yyyy = parts[2]; }

                const targetDay = parseInt(dd, 10).toString();
                const targetMonthIdx = parseInt(mm, 10) - 1;
                const targetYear = yyyy;

                const wrappers = Array.from(document.querySelectorAll('.mx-input-wrapper'));
                const targetWrapper = wrappers.find(w => w.innerText.toLowerCase().includes('tanggal lahir'));

                if (targetWrapper) {
                    await ultraClick(targetWrapper);
                    await wait(800);

                    const btnYear = document.querySelector('.mx-btn-current-year');
                    if (btnYear) {
                        await ultraClick(btnYear);
                        await wait(600);
                        for (let i = 0; i < 15; i++) {
                            if(isCancelled) return;
                            const yearCells = Array.from(document.querySelectorAll('.mx-table-year td'));
                            const cell = yearCells.find(c => c.innerText.trim() === targetYear);
                            if (cell) { await ultraClick(cell); await wait(600); break; }
                            else {
                                const btnPrev = document.querySelector('.mx-btn-icon-double-left') || document.querySelector('.mx-icon-double-left')?.closest('button');
                                if (btnPrev) { await ultraClick(btnPrev); await wait(500); }
                                else break;
                            }
                        }
                    }

                    if (document.querySelectorAll('.mx-table-month td').length === 0 && !isCancelled) {
                        const btnMonth = document.querySelector('.mx-btn-current-month');
                        if (btnMonth) { await ultraClick(btnMonth); await wait(600); }
                    }

                    const monthCells = Array.from(document.querySelectorAll('.mx-table-month td'));
                    if (monthCells.length > targetMonthIdx && !isCancelled) { await ultraClick(monthCells[targetMonthIdx]); await wait(600); }

                    const dateCells = Array.from(document.querySelectorAll('.mx-table-date td:not(.not-current-month):not(.out-in)'));
                    const dayCell = dateCells.find(c => c.innerText.trim() === targetDay);
                    if (dayCell && !isCancelled) { await ultraClick(dayCell); await wait(800); }
                }
            }
        }

        if(isCancelled) { handlePembatalan(); return; }
        hideLoading();
        showToast("Halaman 1 selesai diisi otomatis!", "success");
        
        document.getElementById("infoAI").innerHTML = `
            <div style="background:#00ff88; color:#000; padding:8px; border-radius:5px; text-align:center; font-weight:bold; margin-bottom:8px;">
                ✅ HALAMAN 1 OTOMATIS
            </div>
            <div style="background:#222; border:1px solid #555; padding:8px; border-radius:5px; font-size:12px; line-height:1.7;">
                • Nama: <b style="color:#00ff88;">${data.nama || '-'}</b><br>
                • Tgl: <b style="color:#00ff88;">${data.tgl || '-'}</b><br>
            </div>
        `;

        // --- AUTO NEXT ---
        let btnLanjut = null;
        while(!isCancelled){
            btnLanjut = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Selanjutnya'));
            if(btnLanjut && !btnLanjut.disabled && !btnLanjut.classList.contains('ant-btn-disabled')) { break; }
            await wait(500);
        }

        if(isCancelled) { handlePembatalan(); return; }
        await ultraClick(btnLanjut);

        while(!isCancelled){
            const lanjutBtn = Array.from(document.querySelectorAll('button.btn-fill-primary')).find(btn => (btn.innerText || "").includes("Lanjutkan"));
            if(lanjutBtn){ await ultraClick(lanjutBtn); break; }
            await wait(500);
        }

        // --- HALAMAN 2 ---
        if(!isCancelled) await eksekusiHalamanDua(data);
        if(isCancelled) { handlePembatalan(); return; }
            
        // --- TRIGGER ESTAFET & SMART PAUSE ---
        let kategori = getKategoriUmur(data.tgl);
        try { 
            GM_setValue('PASIEN_AKTIF_TALBOD', JSON.stringify({ nik: data.nik, kategori: kategori })); 
        } catch(e) { 
            localStorage.setItem('PASIEN_AKTIF_TALBOD', JSON.stringify({ nik: data.nik, kategori: kategori })); 
        }
            
        playSound('sukses');
        
        // Setup UI saat Sukses Berhasil Terdaftar
        document.getElementById("btn-batal-ai").style.display = "none";
        document.getElementById("btn-direct-skrining").style.display = "block";
        document.getElementById("infoAI").innerHTML = `
            <div style="background:#00ff88; color:#000; padding:8px; border-radius:5px; text-align:center; font-weight:bold;">
                🎉 TERDAFTAR SUKSES!
            </div>
            <p style="font-size:11px; color:#aaa; text-align:center; margin-top:5px;">Silakan klik tombol di bawah untuk langsung eksekusi skrining mandiri.</p>
        `;

        showLoading("✅ PENDAFTARAN SELESAI!<br><span style='font-size:15px;color:#fff;'>Data tersimpan di Estafet.<br>Siap eksekusi Skrining!</span>");
        await wait(1000);
        hideLoading();

    } catch (err) {
        sendBotErrorLog("autoPilotSikatHabis", err.message || err);
        hideLoading();
        showToast("Terjadi kendala sistem.", "error");
    }
}

function handlePembatalan() {
    hideLoading();
    isProcessing = false;
    document.getElementById("btn-batal-ai").style.display = "none";
    document.getElementById("infoAI").innerHTML = `<b style="color:#ff3333;">❌ Proses Dihentikan Paksa!</b>`;
    showToast("Otomatisasi dibatalkan oleh pengguna.", "warning");
}

/* ================= UI KONTROL & DRAGGABLE LOGIC ================= */
function initUI(){
    if(document.getElementById("reg-ckg-ai-box")) return;

    const box = document.createElement("div");
    box.id = "reg-ckg-ai-box";
    box.style = "position:fixed;top:150px;right:20px;background:#111;color:#fff;padding:15px;border-radius:12px;z-index:99999;width:270px;font-family:sans-serif;box-shadow:0 0 15px #00ff88; border: 2px solid #222;";

    box.innerHTML = `
        <div id="dragHeader" style="text-align:center; margin-bottom:10px; cursor:move; background:#222; padding:8px; border-radius:8px; border:1px solid #444;">
            <b style="color:#00ff88; font-size:16px;">Register CKG</b><br>
            <span style="font-size:10px; color:#aaa; letter-spacing:1px;">UPTD Puskesmas Talaga Bodas</span>
        </div>
        <div style="background:#222; padding:10px; border-radius:8px; text-align:center; margin-bottom:10px; border:1px solid #444;">
            <b style="color:#ffcc00; font-size:11px;">⚡ TEMPEL/SCAN NIK DI SINI ⚡</b><br>
            <input id="nikAI" placeholder="16 Digit NIK..." style="width:90%; margin-top:8px; padding:8px; border-radius:5px; background:#000; color:#00ff88; font-weight:bold; text-align:center; border:1px solid #00ff88; outline:none;">
        </div>
        <div id="infoAI" style="font-size:12px; line-height:1.5; color:#ccc; margin-bottom:10px;">
            Status: <b style="color:#00ff88;">Siaga. Menunggu NIK...</b>
        </div>
        
        <button id="btn-batal-ai" style="display:none; width:100%; padding:10px; background:#ef4444; color:#fff; border:none; border-radius:6px; font-weight:bold; cursor:pointer; margin-bottom:5px; box-shadow:0 2px 5px rgba(0,0,0,0.3);">🛑 BATALKAN PROSES</button>
        <button id="btn-direct-skrining" style="display:none; width:100%; padding:11px; background:#10b981; color:#fff; border:none; border-radius:6px; font-weight:bold; cursor:pointer; box-shadow:0 0 10px #10b981;">⏩ DIRECT KE SKRINING</button>
    `;
    document.body.appendChild(box);

    // Draggable Engine
    const dragHeader = document.getElementById("dragHeader");
    let isDraggingBox = false;
    let offsetX, offsetY;

    dragHeader.addEventListener('mousedown', function(e) {
        isDraggingBox = true;
        offsetX = e.clientX - box.getBoundingClientRect().left;
        offsetY = e.clientY - box.getBoundingClientRect().top;
        box.style.opacity = "0.8";
    });

    document.addEventListener('mousemove', function(e) {
        if (isDraggingBox) {
            box.style.right = 'auto'; box.style.bottom = 'auto';
            box.style.left = (e.clientX - offsetX) + 'px';
            box.style.top = (e.clientY - offsetY) + 'px';
        }
    });

    document.addEventListener('mouseup', function() {
        if (isDraggingBox) { isDraggingBox = false; box.style.opacity = "1"; }
    });

    // Event Klik Tombol Batal
    document.getElementById("btn-batal-ai").onclick = () => {
        isCancelled = true;
        handlePembatalan();
    };

    // Event Klik Tombol Direct Skrining
    document.getElementById("btn-direct-skrining").onclick = () => {
        try {
            // Set CKG_MODE ke modus skrining agar Launcher memicu modul skrining secara otomatis saat reload
            if (typeof GM_setValue !== "undefined") {
                GM_setValue('CKG_MODE', 'skrining');
            } else {
                localStorage.setItem('CKG_MODE', 'skrining');
            }
            showToast("Beralih ke Modul Skrining Mandiri...", "success");
            setTimeout(() => { window.location.reload(); }, 800);
        } catch(e) {
            alert("Gagal melakukan direct. Silahkan refresh dan pilih modul manual via launcher launcher.");
        }
    };

    // Event Input Scanner NIK
    document.getElementById("nikAI").addEventListener('input', async (e) => {
        let val = e.target.value.replace(/\D/g, '');
        if (val.length === 16 && !isProcessing) {
            isProcessing = true;
            document.getElementById("infoAI").innerHTML = `<b style="color:#ffcc00;">Mencari NIK: ${val}...</b>`;

            try {
                let data = await cariData(val);
                if (data) {
                    await autoPilotSikatHabis(data);
                } else {
                    showToast(`Data NIK ${val} tidak ditemukan!`, "error");
                    document.getElementById("infoAI").innerHTML = `<b style="color:#ff3333;">Data NIK ${val} tidak ditemukan!</b>`;
                }
            } catch (err) {
                sendBotErrorLog("Pencarian_NIK", err.message || err);
                hideLoading();
                document.getElementById("infoAI").innerHTML = `<b style="color:#ff3333;">Terjadi Kendala. Coba lagi!</b>`;
            } finally {
                e.target.value = "";
                isProcessing = false;
            }
        }
    });
}
setTimeout(initUI, 1500);
})(typeof GM_xmlhttpRequest !== "undefined" ? GM_xmlhttpRequest : null);
