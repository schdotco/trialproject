(function (GM_xmlhttpRequest) {
'use strict';
    const request = GM_xmlhttpRequest;

function wait(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

/* ================= MODE CKG SEKOLAH ================= */

const SHEETS = [{
    id: "0",
    gids: ["0"],
    colNama: 1,
    colTgl: 5,
    colWA: 3,
    colJK: 10,
    colPekerjaan: 12, // Diabaikan di CKG Sekolah
    colSekolah: 7,   // Pastikan index kolom ini sesuai database Bapak
    colKelas: 8,     // Pastikan index kolom ini sesuai database Bapak
    colDisabilitas: 17, // Pastikan index kolom ini sesuai database Bapak
    colAlamat: 11,
    colMartial: 13,
    waStatis: true
}];

console.log("MODE: CKG SEKOLAH");

let isProcessing = false;
let loadingEl = null;

/* ================= LOADING SCREEN ================= */
function showLoading(text){
    if(loadingEl) { loadingEl.querySelector('#loadText').innerHTML = text; return; }
    loadingEl = document.createElement("div");
    loadingEl.style = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;color:#00c8ff;font-size:20px;font-weight:bold;text-align:center;flex-direction:column;";
    loadingEl.innerHTML = `<div style="background:#111;padding:30px;border-radius:12px;border:3px solid #00c8ff;box-shadow:0 0 20px #00c8ff;"><span id="loadText">${text}</span><br><br><div style="margin:auto;border:6px solid #333;border-top:6px solid #00c8ff;border-radius:50%;width:50px;height:50px;animation:spin 1s linear infinite;"></div></div>`;
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

async function waitAndClickText(text, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const btn = Array.from(document.querySelectorAll('button')).find(btn => (btn.innerText || "").includes(text));
        if (btn) {
            console.log("[BOT] Klik tombol:", text);
            await ultraClick(btn);
            return true;
        }
        await wait(500);
    }
    console.log("[BOT] Timeout:", text);
    return false;
}

async function prosesVerifikasi() {
    while (true) {
        const pilihText = Array.from(document.querySelectorAll('.tracking-wide')).find(el => (el.innerText || "").trim() === "Pilih");
        const pilihBtn = pilihText?.closest('.flex.flex-row.justify-center.gap-2') || pilihText?.parentElement || pilihText;
        if (pilihBtn) {
            await ultraClick(pilihBtn);
            break;
        }
        await wait(500);
    }
    console.log("[BOT] Tombol Pilih berhasil diklik");

    while (true) {
        const daftarBtn = document.querySelector('button.btn-fill-primary-v2');
        if (daftarBtn && daftarBtn.innerText.includes("Daftarkan dengan NIK")) {
            console.log("[BOT] Tombol Daftarkan ditemukan");
            await ultraClick(daftarBtn);
            break;
        }
        await wait(500);
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
        const EXPIRATION_TIME = 1 * 60 * 60 * 1000;
        const now = Date.now();

        try {
            const rawCache = GM_getValue('CKG_MULTISHEET_CACHE');
            cacheTime = parseInt(GM_getValue('CKG_MULTISHEET_CACHE_TIME') || '0');
            if (rawCache) savedCache = JSON.parse(rawCache);
        } catch (e) {
            try {
                const rawCache = sessionStorage.getItem('CKG_MULTISHEET_CACHE');
                cacheTime = parseInt(sessionStorage.getItem('CKG_MULTISHEET_CACHE_TIME') || '0');
                if (rawCache) savedCache = JSON.parse(rawCache);
            } catch (err) {}
        }

        if (savedCache && savedCache.length > 0 && (now - cacheTime < EXPIRATION_TIME)) {
            console.log('[CACHE READY] Memuat data dari penyimpanan lokal...');
            cachedSheetDataList = savedCache;
        } else {
            if (typeof updateStatus === 'function') updateStatus("MENGUNDUH DATA SPREADSHEET...");
            console.log('[DOWNLOAD] Memulai unduhan Multi-Sheet...');
            cachedSheetDataList = [];

            for (let s = 0; s < SHEETS.length; s++) {
                const source = SHEETS[s];
                for (const gid of source.gids) {
                    console.log(`Download Sheet: ${source.id} | GID: ${gid}`);
                    const csv = await new Promise(resolve => {
                        request({
                            method: "GET",
                            url: `https://docs.google.com/spreadsheets/d/${source.id}/export?format=csv&gid=${gid}`,
                            timeout: 10000,
                            onload: r => resolve(r.responseText || ""),
                            onerror: () => resolve("")
                        });
                    });

                    if (!csv || csv.trim() === "") continue;
                    const rows = parseCSV(csv);

                    cachedSheetDataList.push({
                        sheetIndex: s,
                        rows: rows
                    });
                }
            }
            console.log('[DOWNLOAD SELESAI]');
            try {
                GM_setValue('CKG_MULTISHEET_CACHE', JSON.stringify(cachedSheetDataList));
                GM_setValue('CKG_MULTISHEET_CACHE_TIME', now.toString());
            } catch (e) {
                try {
                    sessionStorage.setItem('CKG_MULTISHEET_CACHE', JSON.stringify(cachedSheetDataList));
                    sessionStorage.setItem('CKG_MULTISHEET_CACHE_TIME', now.toString());
                } catch (err) {
                    console.warn("Storage penuh, data hanya disimpan di RAM sementara.");
                }
            }
        }
    }

    for (const cacheItem of cachedSheetDataList) {
        const source = SHEETS[cacheItem.sheetIndex];
        const rows = cacheItem.rows;
        let waD2 = (source.waStatis && rows[1]) ? normalizeNIK(rows[1][3]) : "";

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (Array.isArray(row) && row.find(col => normalizeNIK(col) === target)) {
                return {
                    nik: target,
                    nama: (row[source.colNama] || "").trim(),
                    tgl: (row[source.colTgl] || "").trim(),
                    hp: waD2 || (row[source.colWA] || "").replace(/\D/g,''),
                    jk: (row[source.colJK] || "").trim(),
                    alamat: (row[source.colAlamat] || "").trim(),
                    sekolah: (row[source.colSekolah] || "").trim(),
                    disabilitas: (row[source.colDisabilitas] || "").trim(),
                    kelas: (row[source.colKelas] || "").trim()
                };
            }
        }
    }
    return null;
}

/* ================= ENGINE VUE DROPDOWN (TANPA MODAL) ================= */
async function clickVueDropdown(placeholderKeyword, valueText) {
    console.log(`[BOT] Memilih: "${placeholderKeyword}" -> "${valueText}"`);

    const allDivs = Array.from(document.querySelectorAll('div, span'));
    const trigger = allDivs.find(el =>
        (el.innerText || "").toLowerCase().trim().includes(placeholderKeyword.toLowerCase()) &&
        (el.className.includes('cursor-pointer') || el.closest('.cursor-pointer'))
    );

    if (!trigger) {
        console.log(`[BOT] ❌ Kotak "${placeholderKeyword}" tidak ditemukan.`);
        return false;
    }

    const clickableTrigger = trigger.closest('.cursor-pointer') || trigger;
    await ultraClick(clickableTrigger);
    await wait(1000);

    let optionFound = false;
    for (let i = 0; i < 10; i++) {
        const targetOption = [...document.querySelectorAll('.py-2.px-4.cursor-pointer')].find(el =>
            (el.innerText || '').trim().toLowerCase() === valueText.toLowerCase()
        );

        if (targetOption) {
            await ultraClick(targetOption);
            console.log(`[BOT] ✅ Opsi dipilih: ${valueText}`);
            optionFound = true;
            await wait(1000);
            break;
        }
        await wait(400);
    }

    if (!optionFound) {
        console.log(`[BOT] ❌ Opsi "${valueText}" tidak muncul. Menutup list.`);
        document.body.click();
    }
    return optionFound;
}

/* ================= ENGINE PENCARIAN MODAL (UNTUK SEKOLAH & KELAS) ================= */
async function isiModalPencarian(triggerKeyword, searchPlaceholder, targetValue) {
    if (!targetValue) return;
    console.log(`[BOT] Memproses Pencarian: ${triggerKeyword} | Target: ${targetValue}`);

    const allElements = Array.from(document.querySelectorAll('div, span'));
    const triggerDiv = allElements.find(el => {
        const txt = (el.innerText || "").toLowerCase().trim();
        const rect = el.getBoundingClientRect();
        return txt === triggerKeyword.toLowerCase() && el.children.length === 0 && rect.width > 0;
    });

    if (triggerDiv) {
        console.log(`[BOT] Modal ${triggerKeyword} ditemukan! Membuka...`);
        const clickableArea = triggerDiv.closest('.cursor-pointer') || triggerDiv;
        clickableArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await wait(800);
        await ultraClick(clickableArea);
        await wait(1500);

        const searchInput = document.querySelector(`input[placeholder="${searchPlaceholder}"]`);
        if (searchInput) {
            console.log(`[BOT] Mengetik "${targetValue}" untuk menyortir...`);
            searchInput.focus();
            forceInject(searchInput, targetValue);
            searchInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
            await wait(1500);
        } else {
            clickableArea.click();
            await wait(1500);
        }

        let found = false;
        const optionDivs = Array.from(document.querySelectorAll('.modal-content div.flex.items-center.justify-between'));

        for (let el of optionDivs) {
            let text = (el.innerText || "").trim().toLowerCase();
            if (text === targetValue.toLowerCase() || text.includes(targetValue.toLowerCase())) {
                const parentBtn = el.closest('button') || el;
                console.log(`[BOT] ✅ Opsi ditemukan: "${text}". Mengeklik...`);
                parentBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await wait(500);
                await ultraClick(parentBtn);
                found = true;
                await wait(1000);
                break;
            }
        }

        if (!found) console.log(`[BOT] ⚠️ Pilihan "${targetValue}" tidak ada di sistem.`);

        // Penutupan Agresif
        let cekModal = 0;
        while(document.querySelector(`input[placeholder="${searchPlaceholder}"]`) && cekModal < 8) {
            const closeBtn = document.querySelector('.modal-content header button');
            if (closeBtn) await ultraClick(closeBtn);
            else document.body.click();
            await wait(500);
            cekModal++;
        }
    } else {
        console.log(`[BOT] ❌ Kotak pemicu '${triggerKeyword}' tidak ditemukan.`);
    }
}

/* ================= EKSEKUSI HALAMAN 2 (CKG SEKOLAH) ================= */
async function eksekusiHalamanDua(data) {
    showLoading("⚡ MENGISI HALAMAN 2 (SEKOLAH)... ⚡");

    // Beri jeda agar halaman selesai dimuat sepenuhnya
    await wait(3000);

    /* ================= 1. STATUS PERNIKAHAN (Dipaksa 'Belum Menikah') ================= */
    await clickVueDropdown("Pilih status pernikahan", "Belum Menikah");

    /* ================= 2. PENYANDANG DISABILITAS ================= */
    let disabilitasTarget = (data.disabilitas || "Tidak memiliki disabilitas").trim();
    await clickVueDropdown("Pilih penyandang disabilitas", disabilitasTarget);

    /* ================= 3. NAMA SEKOLAH ================= */
    let sekolahTarget = (data.sekolah || "").trim();
    if(sekolahTarget) {
        await isiModalPencarian("Pilih nama sekolah", "Cari nama sekolah", sekolahTarget);
    }

    /* ================= 4. JENJANG PENDIDIKAN (KELAS) ================= */
    let kelasTarget = (data.kelas || "").trim();
    if(kelasTarget) {
        await isiModalPencarian("Pilih jenjang pendidikan", "Cari jenjang pendidikan", kelasTarget);
    }

    // Jeda sebelum mengeksekusi domisili
    await wait(1500);

    /* ================= 5. CENTANG ALAMAT SAMA DENGAN SEKOLAH ================= */
    console.log("[BOT] Mencentang Alamat sama dengan sekolah...");

    // Cari input aslinya yang tersembunyi di sistem
    const checkboxInput = document.querySelector('input[name="sameAddress"]') || document.querySelector('input[type="checkbox"]#alamat-sama-dengan-sekolah');
    const visualBox = document.querySelector('div.check#alamat-sama-dengan-sekolah');

    if (checkboxInput) {
        // Cek status aslinya dari properti sistem (bukan dari gambar)
        if (!checkboxInput.checked) {
            // Cari elemen pembungkus yang sah untuk diklik oleh sistem Vue
            const clickableWrapper = checkboxInput.closest('label') || visualBox || checkboxInput;

            clickableWrapper.scrollIntoView({ behavior:"smooth", block:"center" });
            await wait(500);

            // Klik area tersebut dengan sistem click yang menembus ke dalam
            await ultraClick(clickableWrapper);
            await wait(800);

            // Jika sistem masih bandel belum merespon klik, kita paksa suntik event-nya
            if (!checkboxInput.checked) {
                checkboxInput.checked = true;
                checkboxInput.dispatchEvent(new Event('click', { bubbles: true }));
                checkboxInput.dispatchEvent(new Event('input', { bubbles: true }));
                checkboxInput.dispatchEvent(new Event('change', { bubbles: true }));
            }

            console.log("[BOT] ✅ Kotak alamat dicentang (Vue API Triggered).");

            // Wajib tunggu agak lama agar API Kemenkes selesai loading menarik nama Kecamatan & Kelurahan
            await wait(2500);
        } else {
            console.log("[BOT] Kotak alamat sudah tercentang dari awal.");
        }
    } else if (visualBox) {
        // Fallback jika input aslinya tiba-tiba disembunyikan web
        if (!visualBox.innerHTML.includes("svg")) {
            await ultraClick(visualBox);
            await wait(2500);
        }
    }

    /* ================= 6. DETAIL DOMISILI ================= */
    console.log("[BOT] Mengisi Detail Alamat...");
    let inpAlamat = document.getElementById('detail-domisili') || document.querySelector('textarea[name="detail-domisili"]');

    if(inpAlamat){
        inpAlamat.scrollIntoView({ behavior:"smooth", block:"center" });
        await wait(500);

        let alamatTarget = data.alamat || "-";
        forceInject(inpAlamat, alamatTarget);

        await wait(500);
        inpAlamat.dispatchEvent(new Event('input', { bubbles:true }));
        inpAlamat.dispatchEvent(new Event('change', { bubbles:true }));
        inpAlamat.blur();
        console.log("[BOT] Detail alamat terisi.");
    }

    hideLoading();

    console.log("[BOT] Halaman 2 selesai diproses.");
    console.log("[BOT] Menunggu user melengkapi data...");

    document.getElementById("infoAI").innerHTML += `
    <div style="
        margin-top:8px;
        padding:6px;
        background:#222;
        border-radius:5px;
        color:#ffcc00;
    ">
    ⏳ Menunggu tombol Selanjutnya aktif...
    </div>
    `;

    let counter = 0;

    while(true){
        const btnNext2 = Array.from(document.querySelectorAll("button")).find(btn => {
            const txt = (btn.innerText || "").trim();
            return (txt === "Selanjutnya" && !btn.disabled && btn.offsetParent !== null);
        });

        if(btnNext2){
            console.log("[BOT] Tombol Selanjutnya aktif");
            await ultraClick(btnNext2);
            console.log("[BOT] Menuju halaman verifikasi");
            await wait(3000);
            await prosesVerifikasi();
            break;
        }
        await wait(1000);
    }
}

/* ================= SISTEM SEMI AUTO-PILOT ================= */
async function autoPilotSikatHabis(data) {
    showLoading("⚡ AUTO-PILOT AKTIF ⚡<br><span style='font-size:14px;color:#fff;'>Mengisi NIK...</span>");

    const btnTambah = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Tambah Baru') || b.innerText.includes('Tambah Peserta'));
    if (btnTambah && !document.querySelector('.ant-modal-content')) {
        ultraClick(btnTambah);
        await wait(1500);
    }

    const inpNIK = getInput("nik");
    if (inpNIK) {
        forceInject(inpNIK, data.nik);
        await wait(300);
        const btnCek = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Cek NIK') || b.innerText.includes('Cari'));
        if (btnCek) ultraClick(btnCek);
    }

    showLoading("⏳ Menunggu Dukcapil Mereset Form...");
    await wait(5000);
    showLoading("⚡ MENGISI DATA AWAL... ⚡");

    let inpNama = getInput("nama lengkap");
    if (inpNama) forceInject(inpNama, data.nama);

    let cleanHP = (data.hp || "").replace(/^0/, "");
    let inpWA = getInput("whatsapp") || getInput("telepon");
    if (inpWA) forceInject(inpWA, cleanHP);

    /* ================= ISI JK (VUE/TAILWIND DROPDOWN) ================= */
    console.log("[BOT] Memproses Jenis Kelamin:", data.jk);
    let rawJK = (data.jk || "").trim().toUpperCase();
    let textToFindJK = "";

    if (rawJK.includes("LAKI") || rawJK === "L" || rawJK === "LK") {
        textToFindJK = "Laki-laki";
    } else if (rawJK.includes("PEREM") || rawJK === "P" || rawJK === "PR" || rawJK.includes("WANITA")) {
        textToFindJK = "Perempuan";
    }

    if (textToFindJK !== "") {
        const allElements = Array.from(document.querySelectorAll('span, div.cursor-pointer, label'));
        const triggerJK = allElements.find(el => {
            const txt = (el.innerText || "").toLowerCase().trim();
            return txt === 'pilih jenis kelamin' || txt === 'jenis kelamin';
        });

        if (triggerJK) {
            const clickableTrigger = triggerJK.closest('.cursor-pointer') || triggerJK;
            await ultraClick(clickableTrigger);
            await wait(1000);

            let optionFound = false;
            for (let i = 0; i < 15; i++) {
                const possibleOptions = Array.from(document.querySelectorAll('*')).filter(el => {
                    return (el.innerText || "").trim() === textToFindJK && el.children.length === 0;
                });

                if (possibleOptions.length > 0) {
                    const targetOption = possibleOptions[possibleOptions.length - 1];
                    await ultraClick(targetOption);
                    console.log("[BOT] Sukses mengklik Jenis Kelamin:", textToFindJK);
                    optionFound = true;
                    await wait(800);
                    break;
                }
                await wait(400);
            }
        }
    }

    /* ================= ISI TANGGAL ================= */
    let tglRaw = data.tgl || "";
    if (tglRaw.trim() !== "") {
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

                if (document.querySelectorAll('.mx-table-month td').length === 0) {
                    const btnMonth = document.querySelector('.mx-btn-current-month');
                    if (btnMonth) { await ultraClick(btnMonth); await wait(600); }
                }

                const monthCells = Array.from(document.querySelectorAll('.mx-table-month td'));
                if (monthCells.length > targetMonthIdx) { await ultraClick(monthCells[targetMonthIdx]); await wait(600); }

                const dateCells = Array.from(document.querySelectorAll('.mx-table-date td:not(.not-current-month):not(.out-in)'));
                const dayCell = dateCells.find(c => c.innerText.trim() === targetDay);
                if (dayCell) { await ultraClick(dayCell); await wait(800); }
            }
        }
    }

/* ================= INFO UI ================= */
hideLoading();
document.getElementById("infoAI").innerHTML = `
    <div style="background:#00c8ff; color:#000; padding:8px; border-radius:5px; text-align:center; font-weight:bold; margin-bottom:8px;">
        ✅ HALAMAN 1 OTOMATIS
    </div>
    <div style="background:#222; border:1px solid #555; padding:8px; border-radius:5px; font-size:12px; line-height:1.7;">
        <b>📌 DATA SEKOLAH:</b><br><br>
        • Nama: <b style="color:#00c8ff;">${data.nama || '-'}</b><br>
        • Tgl: <b style="color:#00c8ff;">${data.tgl || '-'}</b><br>
        • Sekolah: <b style="color:#00c8ff;">${data.sekolah || '-'}</b><br>
        • Kelas: <b style="color:#00c8ff;">${data.kelas || '-'}</b><br>
        • Disabilitas: <b style="color:#00c8ff;">${data.disabilitas || 'Tidak memiliki disabilitas'}</b><br>
    </div>
    <div style="margin-top:8px; font-size:11px; color:#aaa; text-align:center;">
        Bot memantau tombol <b>'Selanjutnya'</b>...
    </div>
`;

/* ================= AUTO NEXT ================= */
let btnLanjut = null;

while(true){
    btnLanjut = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Selanjutnya'));
    if(btnLanjut && !btnLanjut.disabled && !btnLanjut.classList.contains('ant-btn-disabled')){
        break;
    }
    await wait(500);
}

await ultraClick(btnLanjut);
console.log("[BOT] Menunggu popup Lanjutkan...");

while(true){
    const lanjutBtn = Array.from(document.querySelectorAll('button.btn-fill-primary')).find(btn => (btn.innerText || "").includes("Lanjutkan"));
    if(lanjutBtn){
        console.log("[BOT] Popup validasi ditemukan");
        await ultraClick(lanjutBtn);
        break;
    }
    await wait(500);
}

/* ================= HALAMAN 2 ================= */
await eksekusiHalamanDua(data);
}

/* ================= UI KONTROL & DRAGGABLE LOGIC ================= */
function initUI(){
    if(document.getElementById("reg-ckg-ai-box")) return;

    const box = document.createElement("div");
    box.id = "reg-ckg-ai-box";
    box.style = "position:fixed;top:150px;right:20px;background:#111;color:#fff;padding:15px;border-radius:12px;z-index:99999;width:270px;font-family:sans-serif;box-shadow:0 0 15px #00c8ff; border: 2px solid #222;";

    // PERBAIKAN: Menambahkan elemen tombol Reset/Update di bawah input NIK
    box.innerHTML = `
        <div id="dragHeader" style="text-align:center; margin-bottom:10px; cursor:move; background:#222; padding:8px; border-radius:8px; border:1px solid #444;" title="Klik dan tahan untuk menggeser bot">
            <b style="color:#00c8ff; font-size:16px;">Register SEKOLAH</b><br>
            <span style="font-size:10px; color:#aaa; letter-spacing:1px;">UPTD Puskesmas Cijerah (Coming Soon)</span>
        </div>
        <div style="background:#222; padding:10px; border-radius:8px; text-align:center; margin-bottom:10px; border:1px solid #444;">
            <b style="color:#ffcc00; font-size:11px;">⚡ TEMPEL/SCAN NIK DI SINI ⚡</b><br>
            <input id="nikAI" placeholder="16 Digit NIK..." style="width:90%; margin-top:8px; padding:8px; border-radius:5px; background:#000; color:#00c8ff; font-weight:bold; text-align:center; border:1px solid #00c8ff; outline:none;">

            <button id="btnResetBot" style="width:95%; margin-top:10px; padding:8px; border-radius:5px; background:#b30000; color:#fff; font-weight:bold; cursor:pointer; border:1px solid #ff3333; transition:0.2s;" title="Hapus cache dan download ulang database terbaru">
                ♻️ BERSIHKAN & UPDATE DATA
            </button>
        </div>
        <div id="infoAI" style="font-size:12px; line-height:1.5; color:#ccc;">
            Status: <b style="color:#00c8ff;">Siaga. Menunggu NIK...</b>
        </div>
    `;
    document.body.appendChild(box);

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
            box.style.right = 'auto';
            box.style.bottom = 'auto';
            box.style.left = (e.clientX - offsetX) + 'px';
            box.style.top = (e.clientY - offsetY) + 'px';
        }
    });

    document.addEventListener('mouseup', function() {
        if (isDraggingBox) {
            isDraggingBox = false;
            box.style.opacity = "1";
        }
    });

    // === LOGIKA BARU: TOMBOL BERSIHKAN & UPDATE ===
    document.getElementById("btnResetBot").addEventListener('click', async () => {
        // 1. Bersihkan status bot dan form NIK agar siap menerima data baru
        document.getElementById("nikAI").value = "";
        isProcessing = false;
        cachedSheetDataList = null;

        document.getElementById("infoAI").innerHTML = `<b style="color:#ffcc00;">Menghapus Cache & Mengunduh Ulang... ⏳</b>`;

        // 2. Hapus total cache dari memori browser (Tampermonkey & SessionStorage)
        try { GM_deleteValue('CKG_SEKOLAH_CACHE'); GM_deleteValue('CKG_SEKOLAH_CACHE_TIME'); } catch(e){}
        try { sessionStorage.removeItem('CKG_SEKOLAH_CACHE'); sessionStorage.removeItem('CKG_SEKOLAH_CACHE_TIME'); } catch(e){}

        // 3. Paksa bot mendownload data terbaru dari Spreadsheet saat itu juga secara background
        try {
            await cariData("0000000000000000"); // Angka nol ini hanya pancingan agar fungsi download jalan
            document.getElementById("infoAI").innerHTML = `<b style="color:#00c8ff;">✅ Database Terbaru Berhasil Diunduh!<br>Silakan masukkan NIK.</b>`;
        } catch (err) {
            document.getElementById("infoAI").innerHTML = `<b style="color:#ff3333;">❌ Gagal mengunduh. Periksa koneksi internet Anda.</b>`;
        }
    });

    // === LOGIKA INPUT NIK NORMAL ===
    async function prosesNIK(val) {
        if (val.length === 16) {
            if (isProcessing) {
                console.log("[BOT] Gagal: Bot sedang memproses data lain.");
                document.getElementById("infoAI").innerHTML = `<b style="color:#ff3333;">Bot sedang sibuk! Klik "Bersihkan & Update" jika macet.</b>`;
                return;
            }
            
            isProcessing = true;
            document.getElementById("infoAI").innerHTML = `<b style="color:#ffcc00;">Mencari NIK: ${val}...</b>`;

            try {
                let data = await cariData(val);
                if (data) {
                    await autoPilotSikatHabis(data);
                } else {
                    document.getElementById("infoAI").innerHTML = `<b style="color:#ff3333;">Data NIK ${val} tidak ditemukan!</b>`;
                }
            } catch (err) {
                console.log("[BOT ERROR]", err);
                hideLoading();
                document.getElementById("infoAI").innerHTML = `<b style="color:#ff3333;">Terjadi Kendala. Coba lagi!</b>`;
            } finally {
                document.getElementById("nikAI").value = "";
                isProcessing = false;
            }
        } else {
            console.log("[BOT] NIK belum 16 digit, saat ini: " + val.length);
        }
    }

    // Listener Input Biasa
    document.getElementById("nikAI").addEventListener('input', async (e) => {
        let val = e.target.value.replace(/\D/g, '');
        prosesNIK(val);
    });

    // Listener Khusus Paste
    document.getElementById("nikAI").addEventListener('paste', async (e) => {
        // Beri waktu 50ms agar nilai input terisi sempurna sebelum dibaca
        setTimeout(() => {
            let val = e.target.value.replace(/\D/g, '');
            console.log("[BOT] Paste terdeteksi, NIK: " + val);
            prosesNIK(val);
        }, 50);
    });
}
setTimeout(initUI, 1500);
})(typeof GM_xmlhttpRequest !== "undefined" ? GM_xmlhttpRequest : null);
