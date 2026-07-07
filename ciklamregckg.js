(function (GM_xmlhttpRequest) {
'use strict';
    const request = GM_xmlhttpRequest;

function wait(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }
    
/* ================= MODE CKG UMUM ================= */

const SHEETS = [{
    id: "1aavWN9ScsvRBY1iZj9gY1GQ0AFgBieCe",
    gids: ["1054280612"],
    colNama: 4,
    colTgl: 5,
    colWA: 10,
    colJK: 6,
    colPekerjaan: 12,
    colKelurahan: 20,
    colAlamat: 9,
    colMartial: 13,
    waStatis: true
}];

console.log("MODE: CKG UMUM");

let isProcessing = false;
let loadingEl = null;
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

async function waitAndClickText(text, timeout = 30000) {

    const start = Date.now();

    while (Date.now() - start < timeout) {

        const btn = Array.from(
            document.querySelectorAll('button')
        ).find(btn =>
            (btn.innerText || "").includes(text)
        );

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

        const pilihText = Array.from(
            document.querySelectorAll('.tracking-wide')
        ).find(el =>
            (el.innerText || "").trim() === "Pilih"
        );
        
        const pilihBtn =
            pilihText?.closest('.flex.flex-row.justify-center.gap-2') ||
            pilihText?.parentElement ||
            pilihText;

        if (pilihBtn) {
            await ultraClick(pilihBtn);
            break;
        }

        await wait(500);
    }

    console.log("[BOT] Tombol Pilih berhasil diklik");

    while (true) {
    
        const daftarBtn = document.querySelector(
            'button.btn-fill-primary-v2'
        );
    
        if (
            daftarBtn &&
            daftarBtn.innerText.includes("Daftarkan dengan NIK")
        ) {
    
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

async function cariData(nikInput){
    const target = normalizeNIK(nikInput);
    for(const source of SHEETS){
        for(const gid of source.gids){
            const csv = await new Promise(resolve => {
                request({
                    method: "GET", url: `https://docs.google.com/spreadsheets/d/${source.id}/export?format=csv&gid=${gid}`,
                    timeout: 10000, onload: r => resolve(r.responseText || ""), onerror: () => resolve("")
                });
            });

            if(!csv || csv.trim()==="") continue;
            const rows = parseCSV(csv);
            let waD2 = (source.waStatis && rows[1]) ? normalizeNIK(rows[1][3]) : "";

            for(let i=1;i<rows.length;i++){
                const row = rows[i];
                if(row.find(col => normalizeNIK(col) === target)){
                    return {
                        nik: target,
                        nama: (row[source.colNama] || "").trim(),
                        tgl: (row[source.colTgl] || "").trim(),
                        hp: waD2 || (row[source.colWA] || "").replace(/\D/g,''),
                        jk: (row[source.colJK] || "").trim(),
                        alamat: (row[source.colAlamat] || "").trim(),
                        pekerjaan: (row[source.colPekerjaan] || "").trim(),
                        kelurahan: (row[source.colKelurahan] || "").trim(),
                        sekolah: (row[source.colSekolah] || "").trim(),
                        disabilitas: (row[source.colDisabilitas] || "").trim(),
                        Martial: (row[source.colMartial] || "").trim(),
                        kelas: (row[source.colKelas] || "").trim()
                    };
                }
            }
        }
    }
    return null;
}

/* ================= ENGINE VUE DROPDOWN (REVISI KHUSUS) ================= */
async function clickVueDropdown(placeholderKeyword, valueText) {
    console.log(`[DEBUG] Mencari kotak: "${placeholderKeyword}"`);

    // 1. Cari kotak trigger berdasarkan placeholder
    const allDivs = Array.from(document.querySelectorAll('div'));
    const trigger = allDivs.find(el =>
        (el.innerText || "").toLowerCase().trim().includes(placeholderKeyword.toLowerCase()) &&
        el.className.includes('cursor-pointer') // Memastikan ini adalah kotak dropdown
    );

    if (!trigger) {
        console.log(`[DEBUG] ❌ Kotak "${placeholderKeyword}" tidak ditemukan.`);
        return false;
    }

    // Klik kotak untuk membuka menu
    trigger.click();
    await wait(1000);

    // 2. Cari Opsi dengan metode "Scan Semua Teks"
    console.log(`[DEBUG] Mencari opsi: "${valueText}"`);
    let optionFound = false;

    // Kita ambil semua elemen yang mungkin mengandung opsi
    const allOptions = Array.from(document.querySelectorAll('div'));
    const targetOption = allOptions.find(el =>
        (el.innerText || "").trim() === valueText &&
        el.className.includes('justify-between') // Sesuai dengan struktur inspect Anda
    );

    if (targetOption) {
        console.log(`[DEBUG] ✅ Opsi ditemukan! Melakukan klik...`);
        targetOption.scrollIntoView({ behavior: "smooth", block: "center" });
        await wait(300);

        // Pemicu klik manual
        targetOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        targetOption.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        targetOption.click();

        optionFound = true;
        await wait(800);
    } else {
        console.log(`[DEBUG] ❌ Opsi "${valueText}" tidak ditemukan. Menutup dropdown.`);
        document.body.click();
    }

    return optionFound;
}

/* ================= FUNGSI KHUSUS: STATUS PERNIKAHAN ================= */
async function fillAndValidate(placeholderKeyword, valueText, isSearchable = false) {
    console.log(`[BOT] Memproses: ${placeholderKeyword} | Target: ${valueText}`);

    // 1. Cari & Klik Trigger
    const triggers = Array.from(document.querySelectorAll('div, span'));
    const trigger = triggers.find(el =>
        (el.innerText || "").toLowerCase().trim().includes(placeholderKeyword.toLowerCase()) &&
        (el.className.includes('cursor-pointer') || el.closest('.cursor-pointer'))
    );

    if (!trigger) {
        console.error(`[BOT] ❌ Trigger "${placeholderKeyword}" tidak ditemukan!`);
        return false;
    }

    await ultraClick(trigger.closest('.cursor-pointer') || trigger);
    await wait(1200); // Tunggu dropdwon terbuka

    // 2. Jika perlu cari (Pekerjaan)
    if (isSearchable) {
        const searchInput = document.querySelector('input[placeholder*="Cari"]');
        if (searchInput) {
            forceInject(searchInput, valueText);
            await wait(2000); // Wajib tunggu API filter website
        }
    }

    // 3. Pilih Opsi
    const allDivs = Array.from(document.querySelectorAll('div'));
    const targetOption = allDivs.find(el => (el.innerText || "").trim() === valueText);

    if (targetOption) {
        await ultraClick(targetOption);
        await wait(1000);

        // 4. VALIDASI (Penting!)
        // Mengecek apakah teks trigger sekarang sudah berubah menjadi valueText
        const triggerUpdated = triggers.find(el => (el.innerText || "").trim() === valueText);
        if (triggerUpdated) {
            console.log(`[BOT] ✅ Sukses tervalidasi: ${valueText}`);
            return true;
        } else {
            console.warn(`[BOT] ⚠️ Pilihan diklik, tapi sistem tidak merespon. Mencoba ulang...`);
            return false;
        }
    }
    return false;
}

/* ================= ENGINE ALAMAT WILAYAH VUE (BARU) ================= */
async function setAlamatDomisiliVue() {
    console.log("[BOT] Menyetel Alamat Domisili Otomatis...");
    const steps = ["Jawa Barat", "Kota Bandung", "Coblong", "Sekeloa"];

    const allElements = Array.from(document.querySelectorAll('div, span'));
    const trigger = allElements.find(el => (el.innerText || "").toLowerCase().trim() === "pilih alamat domisili" && el.children.length === 0);

    if (!trigger) return false;
    await ultraClick(trigger.closest('.cursor-pointer') || trigger);
    await wait(1000);

    // Loop berurutan (Provinsi -> Kota -> Kecamatan -> Kelurahan)
    for (const step of steps) {
        console.log("[BOT] Memilih wilayah:", step);
        let searchInput = Array.from(document.querySelectorAll('input')).find(el => (el.placeholder || "").toLowerCase().includes("cari"));
        if (searchInput) {
            forceInject(searchInput, step);
            await wait(1500); // Tunggu filter Kemenkes
        }

        let clicked = false;
        for (let i = 0; i < 15; i++) {
            const options = Array.from(document.querySelectorAll('div.flex.items-center.justify-between')).filter(el => (el.innerText || "").trim().toLowerCase() === step.toLowerCase());
            if (options.length > 0) {
                await ultraClick(options[options.length - 1]);
                clicked = true;
                await wait(1000);
                break;
            }
            await wait(400);
        }
        if(!clicked) {
            console.log("[BOT] Gagal di wilayah:", step);
            break;
        }
    }
}

/* ================= EKSEKUSI HALAMAN 2 (VUE VERSION) ================= */
    async function eksekusiHalamanDua(data) {
    showLoading("⚡ MENGISI HALAMAN 2... ⚡");

    // Beri jeda agar halaman selesai dimuat sepenuhnya
    await wait(2500);

/* ================= ISI STATUS PERNIKAHAN (VUE/TAILWIND LOGIC) ================= */
console.log("[BOT] Memproses Status Pernikahan:", data.Martial);
let rawPernikahan = (data.Martial || "").trim().toUpperCase();
let textToFindPernikahan = "";

// Normalisasi data (Pastikan ejaannya sama persis dengan yang muncul di website)
if (rawPernikahan.includes("BELUM")) {
    textToFindPernikahan = "Belum Menikah";
} else if (rawPernikahan.includes("MENIKAH") || rawPernikahan.includes("KAWIN")) {
    textToFindPernikahan = "Menikah";
} else if (rawPernikahan.includes("CERAI HIDUP") || rawPernikahan.includes("CERAI_HIDUP") || rawPernikahan.includes("JANDA") || rawPernikahan.includes("DUDA")) {
    // Janda/Duda otomatis diarahkan ke Cerai Hidup
    textToFindPernikahan = "Cerai Hidup"; 
} else if (rawPernikahan.includes("CERAI MATI") || rawPernikahan.includes("CERAI_MATI")) {
    textToFindPernikahan = "Cerai Mati";
}

if (textToFindPernikahan !== "") {
    // Cari container trigger
    const allElements = Array.from(document.querySelectorAll('span, div.cursor-pointer, label'));
    const triggerPernikahan = allElements.find(el => {
        const txt = (el.innerText || "").toLowerCase().trim();
        return txt === 'pilih status pernikahan' || txt === 'status pernikahan';
    });

    if (triggerPernikahan) {
        // Gunakan klik yang sama dengan yang sukses di Jenis Kelamin
        const clickableTrigger = triggerPernikahan.closest('.cursor-pointer') || triggerPernikahan;
        await ultraClick(clickableTrigger);
        await wait(1000);

        let optionFound = false;
        
        for (let i = 0; i < 15; i++) {
        
            const targetOption = [
                ...document.querySelectorAll(
                    '.py-2.px-4.cursor-pointer'
                )
            ].find(el =>
                (el.innerText || '').trim() ===
                textToFindPernikahan
            );
        
            if (targetOption) {
        
                await ultraClick(targetOption);
        
                console.log(
                    "[BOT] Status Pernikahan dipilih:",
                    textToFindPernikahan
                );
        
                optionFound = true;
                await wait(1000);
                break;
            }
        
            await wait(400);
        }
        if (!optionFound) console.log("[BOT] Error: Opsi Status Pernikahan tidak muncul.");
    } else {
        console.log("[BOT] Error: Kotak 'Status Pernikahan' tidak ditemukan.");
    }
}

/* ================= 2. PEKERJAAN ================= */
    console.log("[BOT] Memproses Pekerjaan...");
    let jobTarget = (data.pekerjaan || data.Pekerjaan || "").trim();
    let jobAsli = jobTarget;

// --- NORMALISASI / MAPPING DATA PEKERJAAN ---
    // (Sumber: Dropdown Internal -> Target: Portal CKG)
    const jobUpper = jobTarget.toUpperCase();

    // 1. Singkatan Belum Bekerja
    if (jobUpper.includes("BLM.") || jobUpper.includes("TIDAK BEKERJA")) {
        jobTarget = "Belum/Tidak Bekerja";
    }
    // 2. Singkatan Ibu Rumah Tangga
    else if (jobUpper.includes("IBU R.TANGGA") || jobUpper.includes("IBU R")) {
        jobTarget = "Ibu Rumah Tangga";
    }
    // 3. Pegawai Negeri / PNS
    else if (jobUpper.includes("PEG. NEGERI") || jobUpper.includes("PNS")) {
        jobTarget = "ASN (Kantor Pemerintah)";
    }
    // 4. Karyawan Swasta
    else if (jobUpper.includes("KARYAWAN SWASTA")) {
        jobTarget = "Pegawai Swasta";
    }
    // 5. Wiraswasta
    else if (jobUpper.includes("WIRASWASTA")) {
        jobTarget = "Wirausaha/Pekerja Mandiri";
    }
    // 6. Buruh
    else if (jobUpper === "BURUH") {
        jobTarget = "Pekerja Pabrik / Buruh";
    }
    // 7. Nelayan & Petani
    else if (jobUpper.includes("NELAYAN")) {
        jobTarget = "Nelayan / Perikanan";
    }
    else if (jobUpper.includes("PETANI")) {
        jobTarget = "Petani / Pekebun";
    }
    // 8. TNI/POLRI (Di CKG dipisah, kita atur default ke TNI)
    else if (jobUpper.includes("TNI/POLRI") || jobUpper.includes("TNI")) {
        jobTarget = "TNI";
    }
    // 9. Purnawirawan (Pensiunan militer/polisi) diarahkan ke Pensiunan
    else if (jobUpper.includes("PURNAWIRAWAN")) {
        jobTarget = "Pensiunan";
    }
    // 10. Lain-lain & Profesional
    else if (jobUpper.includes("LAIN-LAIN") || jobUpper === "PROFESIONAL") {
        jobTarget = "Lainnya";
    }

    // Tampilkan log jika data berhasil diterjemahkan
    if (jobTarget !== jobAsli) {
        console.log(`[BOT] Mapping Pekerjaan: "${jobAsli}" diterjemahkan menjadi -> "${jobTarget}"`);
    }
    // ----------------------------------
    
    if (jobTarget) {
        // 1. Cari Trigger/Kotak Dropdown Pekerjaan
        const triggers = Array.from(document.querySelectorAll('div, span'));
        const triggerPekerjaan = triggers.find(el => 
            (el.innerText || "").toLowerCase().trim() === "pilih pekerjaan" ||
            ((el.innerText || "").toLowerCase().trim().includes("pekerjaan") && el.className.includes('cursor-pointer'))
        );

        if (triggerPekerjaan) {
            triggerPekerjaan.click();
            await wait(1200); // Tunggu modal terbuka penuh

            // 2. Aturan Pencarian: Jika >= 3 kata (suku kata), ambil kata pertama
            const splitKata = jobTarget.split(/\s+/); // Pisahkan berdasarkan spasi
            let kataPencarian = jobTarget;
            
            if (splitKata.length >= 3) {
                kataPencarian = splitKata[0]; // Misal: "Ibu Rumah Tangga" menjadi "Ibu"
                console.log(`[BOT] Job >= 3 kata. Disingkat menjadi: "${kataPencarian}" agar list mengecil.`);
            }

            // Injeksi teks ke kolom search di dalam modal
            const searchInput = document.querySelector('.modal-content input[placeholder*="Cari"], input[placeholder*="Cari"]');
            if (searchInput) {
                console.log(`[BOT] Mengetik pencarian: ${kataPencarian}`);
                forceInject(searchInput, kataPencarian);
                await wait(1500); // Wajib tunggu Vue selesai memfilter list
            }

            // 3. Looping Pencarian Tombol Asli (Polling Fix)
            let optionFound = false;
            for (let i = 0; i < 20; i++) {
                // Selector persis seperti test manual Anda yang berhasil
                const btn = [...document.querySelectorAll('.modal-content button')].find(x => 
                    (x.innerText || "").trim().toLowerCase() === jobTarget.toLowerCase()
                );

                if (btn) {
                    console.log(`[DEBUG] DITEMUKAN & DIKLIK: ${btn.innerText}`);
                    btn.click(); // Klik native sesuai temuan Anda
                    optionFound = true;
                    await wait(1200); // Tunggu modal menutup
                    break;
                }
                await wait(400); // Ulangi pencarian tiap 400ms jika tombol belum dirender
            }

            // 4. Mencegah UI Nyangkut/Error (UI Ga Kebuka)
            if (!optionFound) {
                console.log(`[BOT] ❌ GAGAL: Opsi "${jobTarget}" tidak ditemukan di list.`);
                document.body.click(); // Paksa klik area luar agar modal tertutup & tidak error menyangkut
                await wait(800);
            }
        } else {
            console.log("[BOT] ❌ Kotak 'Pekerjaan' tidak ditemukan.");
        }
    }

    // WAJIB: Jeda sebelum lanjut ke DOMISILI
    await wait(1500);

    /* ================= 3. ALAMAT DOMISILI ================= */
    console.log("[BOT] Memproses Domisili...");
    showLoading("⚡ MENCARI WILAYAH CIKUTRA LAMA... ⚡");
    await setAlamatDomisiliVue();

    // WAJIB: Berikan jeda krusial setelah API wilayah selesai
    await wait(2000);

    /* ================= 4. DETAIL DOMISILI ================= */
    console.log("[BOT] Mengisi Detail Alamat...");
    showLoading("⚡ MENYUNTIKKAN DETAIL ALAMAT... ⚡");
    let inpAlamat = document.getElementById('detail-domisili') || document.querySelector('textarea[placeholder*="Jl. Kenanga"]');

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

    const btnNext2 = Array.from(
        document.querySelectorAll("button")
    ).find(btn => {

        const txt = (btn.innerText || "").trim();

        return (
            txt === "Selanjutnya" &&
            !btn.disabled &&
            btn.offsetParent !== null
        );

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

    // Normalisasi kata dari spreadsheet (Menangani L/P, LK/PR, Laki/Perempuan)
    if (rawJK.includes("LAKI") || rawJK === "L" || rawJK === "LK") {
        textToFindJK = "Laki-laki";
    } else if (rawJK.includes("PEREM") || rawJK === "P" || rawJK === "PR" || rawJK.includes("WANITA")) {
        textToFindJK = "Perempuan";
    }

    if (textToFindJK !== "") {
        // Cari container yang bertuliskan 'jenis kelamin'
        const allElements = Array.from(document.querySelectorAll('span, div.cursor-pointer, label'));
        const triggerJK = allElements.find(el => {
            const txt = (el.innerText || "").toLowerCase().trim();
            return txt === 'pilih jenis kelamin' || txt === 'jenis kelamin';
        });

        if (triggerJK) {
            // Gunakan pembungkus (wrapper) terdekat yang bisa diklik
            const clickableTrigger = triggerJK.closest('.cursor-pointer') || triggerJK;
            await ultraClick(clickableTrigger);
            await wait(1000); // Tunggu animasi dropdown muncul di layar

            // Cari opsi target (Laki-laki / Perempuan)
            let optionFound = false;
            for (let i = 0; i < 15; i++) {
                // Kita cari elemen leaf (tanpa child agar presisi) yang teksnya persis Laki-laki atau Perempuan
                const possibleOptions = Array.from(document.querySelectorAll('*')).filter(el => {
                    return (el.innerText || "").trim() === textToFindJK && el.children.length === 0;
                });

                if (possibleOptions.length > 0) {
                    // Jika dropdown dirender menggunakan portal (di ujung body HTML), biasanya elemen terakhirlah yang valid/terlihat
                    const targetOption = possibleOptions[possibleOptions.length - 1];

                    // Eksekusi klik pada opsi
                    await ultraClick(targetOption);
                    console.log("[BOT] Sukses mengklik Jenis Kelamin:", textToFindJK);
                    optionFound = true;
                    await wait(800);
                    break;
                }
                await wait(400); // Looping tiap 0.4 detik jika DOM terlambat muncul
            }
            if (!optionFound) console.log("[BOT] Error: Opsi dropdown Jenis Kelamin tidak muncul di layar.");
        } else {
            console.log("[BOT] Error: Kotak 'Jenis Kelamin' tidak ditemukan di formulir.");
        }
    }

    /* ================= ISI TANGGAL (VUE2-DATEPICKER) ================= */
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
    <div style="background:#00ff88; color:#000; padding:8px; border-radius:5px; text-align:center; font-weight:bold; margin-bottom:8px;">
        ✅ HALAMAN 1 OTOMATIS
    </div>
    <div style="background:#222; border:1px solid #555; padding:8px; border-radius:5px; font-size:12px; line-height:1.7;">
        <b>📌 DATA TERISI:</b><br><br>
        • Nama: <b style="color:#00ff88;">${data.nama || '-'}</b><br>
        • Tgl: <b style="color:#00ff88;">${data.tgl || '-'}</b><br>
        • JK: <b style="color:#00ff88;">${data.jk || '-'}</b><br>
        • Status: <b style="color:#00ff88;">${data.Martial || '-'}</b><br>
        • Pekerjaan: <b style="color:#00ff88;">${data.pekerjaan || '-'}</b><br>
        • Kelurahan: <b style="color:#00ff88;">SEKELOA</b><br>
        • Alamat: <div style="color:#00ff88; margin-top:3px; background:#111; padding:6px; border-radius:5px; border:1px solid #333; word-break:break-word; max-height:65px; overflow:auto;">${data.alamat || '-'}</div>
    </div>
    <div style="margin-top:8px; font-size:11px; color:#aaa; text-align:center;">
        Bot memantau tombol <b>'Selanjutnya'</b>...
    </div>
`;

/* ================= AUTO NEXT ================= */
let btnLanjut = null;

while(true){

    btnLanjut = Array.from(
        document.querySelectorAll('button')
    ).find(
        b => b.innerText.includes('Selanjutnya')
    );

    if(
        btnLanjut &&
        !btnLanjut.disabled &&
        !btnLanjut.classList.contains('ant-btn-disabled')
    ){
        break;
    }

    await wait(500);
}

await ultraClick(btnLanjut);

console.log("[BOT] Menunggu popup Lanjutkan...");

while(true){

    const lanjutBtn = Array.from(
        document.querySelectorAll('button.btn-fill-primary')
    ).find(btn =>
        (btn.innerText || "").includes("Lanjutkan")
    );

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
    if(document.getElementById("ai-box")) return;

    const box = document.createElement("div");
    box.id = "ai-box";
    box.style = "position:fixed;top:150px;right:20px;background:#111;color:#fff;padding:15px;border-radius:12px;z-index:99999;width:270px;font-family:sans-serif;box-shadow:0 0 15px #00ff88; border: 2px solid #222;";

    box.innerHTML = `
        <div id="dragHeader" style="text-align:center; margin-bottom:10px; cursor:move; background:#222; padding:8px; border-radius:8px; border:1px solid #444;" title="Klik dan tahan untuk menggeser bot">
            <b style="color:#00ff88; font-size:16px;">Register CKG</b><br>
            <span style="font-size:10px; color:#aaa; letter-spacing:1px;">Puskesmas Cikutra Lama</span>
        </div>
        <div style="background:#222; padding:10px; border-radius:8px; text-align:center; margin-bottom:10px; border:1px solid #444;">
            <b style="color:#ffcc00; font-size:11px;">⚡ TEMPEL/SCAN NIK DI SINI ⚡</b><br>
            <input id="nikAI" placeholder="16 Digit NIK..." style="width:90%; margin-top:8px; padding:8px; border-radius:5px; background:#000; color:#00ff88; font-weight:bold; text-align:center; border:1px solid #00ff88; outline:none;">
        </div>
        <div id="infoAI" style="font-size:12px; line-height:1.5; color:#ccc;">
            Status: <b style="color:#00ff88;">Siaga. Menunggu NIK...</b>
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
                    document.getElementById("infoAI").innerHTML = `<b style="color:#ff3333;">Data NIK ${val} tidak ditemukan!</b>`;
                }
            } catch (err) {
                console.log("[BOT ERROR]", err);
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
