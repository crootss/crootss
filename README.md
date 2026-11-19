# crootss

Engine presentasi spatial 3D berbasis **CSS 3D transforms** murni: `crootss.css` (layout & animasi) + `croot.js` (kamera & navigasi). Tanpa dependency, ±9 KB minified.

Dokumentasi lengkap: https://crootss.if.co.id/docs/

## Pakai via CDN

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/crootss/crootss@v0.5.0/crootss.min.css">
<script type="module" src="https://cdn.jsdelivr.net/gh/crootss/crootss@v0.5.0/croot.min.js"></script>
```

`croot.js` adalah ES module tanpa dependency dan aktif otomatis. Selalu pin versi (lihat [Releases](https://github.com/crootss/crootss/releases)), jangan `@latest`.

## Markup

```html
<div class="croot-viewport" data-croot>
  <div class="croot-stage">
    <section class="croot-node" data-croot-step="1" data-croot-x="0" data-croot-y="0">
      <h1>Halo</h1>
    </section>
    <section class="croot-node" data-croot-step="2" data-croot-x="1400" data-croot-rz="90">
      <h2>Slide berikutnya</h2>
      <!-- node bersarang: koordinat relatif ke pusat induk -->
      <div class="croot-node" data-croot-step="2.1" data-croot-y="150" data-croot-scale="0.25">…</div>
    </section>
  </div>
</div>
```

Tanpa JS, semua node tampil sebagai dokumen biasa (tetap bisa dibaca & diindeks).

| Atribut | Fungsi |
| :-- | :-- |
| `data-croot-step` | Urutan navigasi linier, per segmen: `2` < `2.1` < `2.2` < `2.10` < `3`. Node tanpa step tetap bisa diklik. |
| `data-croot-x` / `y` / `z` | Posisi (px). |
| `data-croot-rx` / `ry` / `rz` | Rotasi (derajat). |
| `data-croot-scale` | Skala node. Kamera otomatis menyesuaikan. |
| `data-croot-target` | Pada elemen apa pun: klik → kamera menuju selector ini. |
| `data-croot="manual"` | Pada root: matikan auto-init. |
| `data-croot-fit` | Pada root: porsi layar yang diisi node (default `0.9`). |
| `data-croot-pullback` | Pada root: kekuatan efek kamera mundur di tengah perpindahan (default `1`, `0` = mati). |
| `data-croot-overview` | Pada root: selector node big picture. Overview membingkai node ini, dan → setelah langkah terakhir kembali ke sana. |
| `data-croot-debug` | Pada root: tandai node yang isinya meluap (garis putus merah, elemen penyebabnya ikut ditandai) dan tulis daftarnya di console. Hapus sebelum tampil. |
| `data-croot-zoom` | Pada gambar/diagram/video: saat node-nya aktif, ketuk untuk layar penuh (`Esc` menutup). Untuk gambar lanskap di ponsel. |
| `class="croot-notes"` | Pada `<aside>` di dalam node: catatan pembicara. Tidak tampil di slide, hanya di jendela presenter. |

Posisi juga bisa ditulis sebagai custom property di CSS, misalnya untuk tata letak berbeda di ponsel: `#kartu { --croot-x: 1400; }`. Nilainya tidak terwariskan ke node anak.

## Konvensi: mulai dari big picture

Presentasi crootss dimulai dari gambaran besar lalu zoom ke detail:

1. Buat **satu node big picture** berisi diagram seluruh presentasi (concept map, system context, rich picture, Business Model Canvas, alur, atau timeline) dan daftarkan dengan `data-croot-overview="#id"` pada root.
2. Tampilkan big picture di awal (langkah 1, atau 2 setelah sampul).
3. Setiap cabang diagram adalah blok; detailnya node anak atau blok di sebelahnya. Urutan: blok → detail → blok berikutnya.
4. Blok satu bidang dengan big picture supaya overview terbaca sebagai satu gambar.
5. `Esc` dan langkah setelah yang terakhir kembali ke big picture.

Kelas diagram (`dg-*`, `bmc`, `flow`, `timeline`) dan animasi (`a-*`) ada di [crootss/themes](https://github.com/crootss/themes). Panduan lengkap: https://crootss.if.co.id/docs/big-picture/

### Alat peta (`tools/peta.py`)

Untuk concept map (pusat, cabang, detail), posisi blok dan garis penghubung tidak perlu ditulis manual. Tulis strukturnya sekali di `peta.json`:

```json
{
  "html": "index.html",
  "css": "slide.css",
  "peta": "peta",
  "pusat": "judul",
  "cabang": [
    {"id": "latar", "label": "berangkat dari", "detail": [{"id": "masalah", "label": "dirumuskan jadi"}]},
    {"id": "metode", "label": "dijawab dengan"},
    {"id": "hasil", "label": "menghasilkan"}
  ]
}
```

Di dalam node big picture, pasang penanda `<!-- peta:garis --><!-- /peta:garis -->`, lalu jalankan (Python 3, tanpa instal apa pun):

```sh
curl -O https://raw.githubusercontent.com/crootss/crootss/main/tools/peta.py
python3 peta.py peta.json
```

Alat ini menulis SVG garis dan label ke HTML, serta posisi `--croot-x/y/scale` untuk desktop dan ponsel ke CSS. Ukuran node big picture dihitung otomatis. Alat juga melaporkan blok yang bertumpukan (`TUMPANG`) dan label yang tidak muat di celahnya (`SEMPIT`). Untuk CI: `python3 peta.py --cek peta.json` gagal bila HTML/CSS belum sesuai, tanpa menulis. Tanpa menyalin berkas: `curl -s …/tools/peta.py | python3 - peta.json`. Hasilnya HTML/CSS biasa yang di-commit, bukan langkah build. Contoh lengkap ada di [`tools/contoh/`](tools/contoh/); opsi lainnya (sudut, jari-jari, ukuran blok) dijelaskan di kepala `tools/peta.py`.

## Navigasi

- **Kamera 3D**: saat pindah ke node yang jauh, kamera mundur sejenak lalu maju lagi (seperti Prezi), sehingga ruang 3D di sekitarnya terlihat. Atur dengan `data-croot-pullback`.
- **Linier**: `→ ↓ Spasi PageDown` / `← ↑ Shift+Spasi PageUp`, `Home` / `End`, swipe.
- **Klik langsung**: klik node mana pun; urutan linier ikut tersinkron.
- **Overview**: `Esc` → kamera membingkai node big picture (`data-croot-overview`), atau tanpa itu mundur sampai seluruh kanvas muat di layar.
- **URL**: setiap node punya alamat `#/<id>`, overview di `#/overview`.
- **Presenter**: `P` membuka jendela kedua berisi catatan pembicara (`<aside class="croot-notes">`), langkah berikutnya, pengatur waktu, dan jam. Tampilkan jendela utama di proyektor (layar penuh dengan `F11`), lalu kendalikan dari jendela presenter atau jendela utama, keduanya tersinkron.
- **Cetak / PDF**: `Ctrl+P` (atau `?print` di URL) mencetak satu langkah per halaman 1280×720, sama dengan yang tampil di layar. Pilih "Simpan sebagai PDF" untuk mengirim ke promotor, panitia, atau arsip. Node yang diputar (`rx`/`ry`) dicetak datar. PDF otomatis tanpa dialog: `curl -s https://raw.githubusercontent.com/crootss/crootss/main/tools/pdf.py | python3 - folder-slide hasil.pdf` (memakai Chrome/Edge/Chromium terpasang; `?print=pdf` menyiapkan halaman tanpa dialog dan menandai `<html data-croot-print="siap">`).

### Catatan pembicara

```html
<section class="croot-node slide" data-croot-step="3">
  <h2>Hasil penelitian</h2>
  <aside class="croot-notes"><p>Sebut jumlah responden dulu.</p></aside>
</section>
```

## API

```js
import { croot } from 'https://cdn.jsdelivr.net/gh/crootss/crootss@v0.5.0/croot.min.js';

const deck = croot('#deck', { fit: 0.9, pullback: 1, hash: true, keyboard: true, touch: true, overview: '#peta', debug: false, presenter: true });
deck.next(); deck.prev(); deck.goto(3); deck.goto('id-node'); deck.overview();
deck.presenter();      // buka jendela presenter (null bila popup diblokir)
deck.print();          // dialog cetak, satu langkah per halaman
deck.checkOverflow();  // [{ node, elements }] node yang isinya meluap
deck.current; deck.index; deck.isOverview; deck.steps; deck.bigPicture; deck.destroy();

deck.root.addEventListener('croot:enter', (e) => console.log(e.target, e.detail.index));
// juga: croot:leave (di node), croot:overview (di root)
```

`croot()` idempoten: memanggilnya pada root yang sudah aktif mengembalikan instance yang sama.

## Kustomisasi CSS

```css
.croot-viewport {
  --croot-perspective: 1000px;
  --croot-speed: 1s;
  --croot-ease: cubic-bezier(0.65, 0, 0.35, 1);
  --croot-node-width: 960px;
  --croot-dim: 0.35; /* opacity node non-aktif */
}
```

Class status: `.croot-ready`, `.croot-overview`, `.croot-moving` (root); `.croot-active` + `aria-current="step"` (node). `prefers-reduced-motion` dihormati otomatis.

## Versi yang cocok

Library dan [tema](https://github.com/crootss/themes) diberi versi terpisah. Pasangan berikut sudah dipakai bersama di landing dan docs; gunakan pasangan terbaru.

| crootss | themes | Catatan |
| :-- | :-- | :-- |
| v0.6.0 | v0.6.1 | Ekspor PDF tanpa dialog (`?print=pdf`, `tools/pdf.py`), `data-croot-zoom`, deteksi isi meluap lebih tepat; tema: stiker tetap di dalam slide di ponsel |
| v0.5.0 | v0.6.0 | Presenter, cetak/PDF, debug isi meluap; tema: kartu potret, kartu saudara diredupkan di ponsel |
| v0.4.0 | v0.5.0, v0.4.0 | Big picture (`data-croot-overview`); tema: diagram, animasi, `matrix`, `figure`, `flow vertical`, `byline` |
| v0.3.0 | v0.3.0, v0.2.1, v0.2.0 | Kamera mundur (pullback) |

Daftar fitur dan perbaikan setiap rilis ada di [Releases](https://github.com/crootss/crootss/releases).

## Pakai tanpa internet

Ruang sidang dan konferensi sering tanpa internet, padahal library, tema, dan font dimuat dari CDN. Saat masih online, buat paket luring:

```sh
curl -O https://raw.githubusercontent.com/crootss/crootss/main/tools/luring.py
python3 luring.py folder-slide          # hasil: folder-slide-luring/
```

Alat ini menyalin deck, mengunduh crootss, tema, font Google, dan impor JS dari CDN ke `vendor/`, lalu mengganti alamatnya ke salinan lokal. `serve.ps1` dan petunjuk `BACA-LURING.txt` ikut disalin. Bawa folder `-luring` itu, lalu jalankan servernya (lihat bagian berikut) tanpa internet. Alat ini memperingatkan rujukan ke file di luar folder deck, karena file itu tidak ikut terbawa. Berkas pengembangan (`.git`, `.github`, `tools/`, `peta.json`, `*.py`, `README.md`, `*.pdf`) tidak disalin; tambah pola lain di `.luringignore`. Tag `preconnect` ke CDN dibuang.

## Menjalankan slide di komputer sendiri

`croot.js` adalah ES module, dan browser **tidak** mau memuat module dari `file://` (klik dua kali `index.html`). Jalankan server lokal di folder slide, lalu buka `http://localhost:8080/`.

**PowerShell** (bawaan Windows, tanpa instal apa pun): buka PowerShell di folder slide, lalu jalankan:

```powershell
irm https://crootss.if.co.id/serve.ps1 | iex
```

Browser terbuka otomatis. Tutup jendela untuk berhenti. Isi skripnya bisa dibaca di [serve.ps1](https://crootss.if.co.id/serve.ps1): server kecil yang mengirim header `Content-Type` yang benar (tanpa header itu browser menolak ES module).

**Python** (bawaan macOS dan Linux): buka terminal di folder slide, lalu jalankan:

```sh
python3 -m http.server 8080
```

Di Windows, ketik `python`. Tekan `Ctrl`+`C` untuk berhenti.

Untuk demo di repo ini, jalankan server di root repo lalu buka `http://localhost:8080/demo/`.

## Pengembangan

Mengikuti [konvensi CrootJS](https://croot.js.org/docs/conventions): vanilla ES module tanpa build, HTML/CSS/JS di file terpisah (tanpa `<style>`, `<script>` inline, `style=""`, atau `onclick`). Panduan tim development ada di [crootss/crootss-dev](https://github.com/crootss/crootss-dev).

- Demo: lihat [Menjalankan slide di komputer sendiri](#menjalankan-slide-di-komputer-sendiri).
- Tes: `node --test 'test/*.test.mjs'`
- Rilis: otomatis. Setiap push ke `main` yang mengubah `croot.js` / `crootss.css` membuat tag + GitHub Release (lihat `.github/workflows/release.yml`). Naik versi mengikuti pesan commit: `feat:` → minor, `feat!:` / `BREAKING CHANGE` → major, lainnya → patch. Bisa dipaksa dengan `#minor` / `#major`.
