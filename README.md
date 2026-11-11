# crootss

Engine presentasi spatial 3D berbasis **CSS 3D transforms** murni: `crootss.css` (layout & animasi) + `croot.js` (kamera & navigasi). Tanpa dependency, ±9 KB minified.

Dokumentasi lengkap: https://crootss.if.co.id/docs/

## Pakai via CDN

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/crootss/crootss@v0.3.0/crootss.min.css">
<script type="module" src="https://cdn.jsdelivr.net/gh/crootss/crootss@v0.3.0/croot.min.js"></script>
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

Posisi juga bisa ditulis sebagai custom property di CSS, misalnya untuk tata letak berbeda di ponsel: `#kartu { --croot-x: 1400; }`. Nilainya tidak terwariskan ke node anak.

## Navigasi

- **Kamera 3D**: saat pindah ke node yang jauh, kamera mundur sejenak lalu maju lagi (seperti Prezi), sehingga ruang 3D di sekitarnya terlihat. Atur dengan `data-croot-pullback`.
- **Linier**: `→ ↓ Spasi PageDown` / `← ↑ Shift+Spasi PageUp`, `Home` / `End`, swipe.
- **Klik langsung**: klik node mana pun; urutan linier ikut tersinkron.
- **Overview**: `Esc` → kamera mundur sampai seluruh kanvas muat di layar (dihitung dari bounding box).
- **URL**: setiap node punya alamat `#/<id>`, overview di `#/overview`.

## API

```js
import { croot } from 'https://cdn.jsdelivr.net/gh/crootss/crootss@v0.3.0/croot.min.js';

const deck = croot('#deck', { fit: 0.9, pullback: 1, hash: true, keyboard: true, touch: true });
deck.next(); deck.prev(); deck.goto(3); deck.goto('id-node'); deck.overview();
deck.current; deck.index; deck.isOverview; deck.steps; deck.destroy();

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
