# crootss

Engine presentasi spatial 3D berbasis **CSS 3D transforms** murni: `crootss.css` (layout & animasi) + `croot.js` (kamera & navigasi). Tanpa dependency, ±9 KB minified.

## Pakai via CDN

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/crootss/crootss@0/crootss.min.css">
<script src="https://cdn.jsdelivr.net/gh/crootss/crootss@0/croot.min.js"></script>
```

Ganti `@0` dengan versi persis (mis. `@v0.1.0`) untuk produksi.

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

Posisi juga bisa ditulis sebagai custom property: `style="--croot-x: 1400"`.

## Navigasi

- **Linier**: `→ ↓ Spasi PageDown` / `← ↑ Shift+Spasi PageUp`, `Home` / `End`, swipe.
- **Klik langsung**: klik node mana pun; urutan linier ikut tersinkron.
- **Overview**: `Esc` → kamera mundur sampai seluruh kanvas muat di layar (dihitung dari bounding box).
- **URL**: setiap node punya alamat `#/<id>`, overview di `#/overview`.

## API

```js
const deck = croot('#deck', { fit: 0.9, hash: true, keyboard: true, touch: true });
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

## Pengembangan

- Demo: buka `demo/index.html` di browser.
- Tes: `node --test 'test/*.test.js'`
- Rilis: otomatis. Setiap push ke `main` yang mengubah `croot.js` / `crootss.css` membuat tag + GitHub Release (lihat `.github/workflows/release.yml`). Naik versi mengikuti pesan commit: `feat:` → minor, `feat!:` / `BREAKING CHANGE` → major, lainnya → patch. Bisa dipaksa dengan `#minor` / `#major`.
