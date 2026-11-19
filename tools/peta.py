#!/usr/bin/env python3
"""Pembuat concept map untuk presentasi crootss.

Dari satu file JSON (pusat, cabang, detail, dan label hubungannya), alat ini
menulis:

- posisi setiap blok (--croot-x/y/scale) untuk desktop dan ponsel ke file CSS,
  di antara penanda /* peta:mulai */ … /* peta:akhir */ (ditambahkan di akhir
  file bila belum ada);
- SVG garis dan label penghubung ke node big picture di HTML, di antara
  penanda <!-- peta:garis --> … <!-- /peta:garis -->.

Koordinat cukup ditulis sekali (di JSON); SVG dan CSS selalu cocok. Hasilnya
HTML/CSS biasa yang di-commit, bukan langkah build. Hanya pustaka standar
Python 3.

    python3 peta.py peta.json
    python3 peta.py --cek peta.json    # CI: gagal bila HTML/CSS belum sesuai, tanpa menulis

Tanpa menyalin berkasnya:

    curl -s https://raw.githubusercontent.com/crootss/crootss/main/tools/peta.py | python3 - peta.json

Sebagai modul: import peta; berkas, laporan, info = peta.buat('peta.json').

Contoh peta.json (path html/css relatif terhadap file JSON):

    {
      "html": "index.html",
      "css": "slide.css",
      "peta": "peta",
      "pusat": "judul",
      "cabang": [
        {"id": "masalah", "label": "berawal dari"},
        {"id": "solusi", "label": "dijawab dengan",
         "detail": [{"id": "demo", "label": "dibuktikan lewat"}]},
        {"id": "biaya", "label": "dibiayai oleh"}
      ]
    }

Kunci opsional: "ukuran" (ukuran blok bila bukan slide 1280x720 / 720x1280,
mis. {"demo": {"ponsel": [720, 1500]}}), serta "desktop" / "ponsel" untuk
mengubah jari-jari, skala, ukuran label, atau ukuran node peta (lihat
BAWAAN). Blok berkelas "tall" otomatis dianggap 900 / 1800 tinggi.

Alat melaporkan blok yang bertumpukan (TUMPANG) dan label yang lebih panjang
dari celah antar-blok (SEMPIT). Perbesar "jari" / "jari_detail" bila muncul.
"""
import json
import math
import os
import re
import sys

BAWAAN = {
    # jari: jari-jari elips cabang (x, y); jari_detail: untuk blok detail.
    # peta: [lebar, tinggi, pusat_y] node big picture; null = dihitung otomatis.
    # sudut_awal: arah cabang pertama (-90 = atas), cabang berikutnya searah
    # jarum jam dengan jarak sama. sebar: selisih sudut antar-detail satu cabang.
    'desktop': {'jari': [3000, 2800], 'jari_detail': [5400, 5000], 'label': 84,
                'garis': 14, 'titik': 42, 'skala': {'pusat': 1.4, 'cabang': 1, 'detail': .8},
                'slide': [1280, 720], 'tall': 900, 'tepi': 500, 'peta': None},
    'ponsel': {'jari': [1700, 3300], 'jari_detail': [3000, 5900], 'label': 56,
               'garis': 14, 'titik': 42, 'skala': {'pusat': 1.4, 'cabang': 1, 'detail': .8},
               'slide': [720, 1280], 'tall': 1800, 'tepi': 400, 'peta': None},
}
CSS_MULAI = '/* peta:mulai (dibuat oleh crootss/tools/peta.py dari peta.json; jangan diedit manual) */'
CSS_AKHIR = '/* peta:akhir */'


def gabung(dasar, ubah):
    hasil = dict(dasar)
    for k, v in (ubah or {}).items():
        hasil[k] = gabung(dasar[k], v) if isinstance(v, dict) and isinstance(dasar.get(k), dict) else v
    return hasil


def baca_spek(path):
    spek = json.load(open(path, encoding='utf-8'))
    for k in ('html', 'css', 'peta', 'pusat', 'cabang'):
        if k not in spek:
            sys.exit(f'peta.json: kunci "{k}" wajib ada')
    return spek


def kelas_blok(html, id):
    m = re.search(r'<\w+[^>]*\bid="%s"[^>]*>' % re.escape(id), html)
    if not m:
        sys.exit(f'Blok #{id} tidak ditemukan di HTML')
    k = re.search(r'\bclass="([^"]*)"', m.group(0))
    return k.group(1).split() if k else []


def susun(spek, L):
    """Posisi (x, y, skala) setiap blok dan daftar hubungan (asal, tujuan, label)."""
    n = len(spek['cabang'])
    a0 = spek.get('sudut_awal', -90)
    sebar = spek.get('sebar', 14)
    sk = L['skala']
    pos = {spek['pusat']: (0, 0, sk['pusat'])}
    sisi = []
    for i, c in enumerate(spek['cabang']):
        a = c.get('sudut', a0 + 360 * i / n)
        t = math.radians(a)
        pos[c['id']] = (round(L['jari'][0] * math.cos(t)), round(L['jari'][1] * math.sin(t)), sk['cabang'])
        sisi.append((spek['pusat'], c['id'], c['label']))
        det = c.get('detail', [])
        for j, d in enumerate(det):
            ad = d.get('sudut', a + (j - (len(det) - 1) / 2) * sebar)
            t = math.radians(ad)
            pos[d['id']] = (round(L['jari_detail'][0] * math.cos(t)), round(L['jari_detail'][1] * math.sin(t)), sk['detail'])
            sisi.append((c['id'], d['id'], d['label']))
    return pos, sisi


def setengah(spek, html, nama, L, id, k):
    w, h = L['slide']
    if 'tall' in kelas_blok(html, id):
        h = L['tall']
    u = spek.get('ukuran', {}).get(id, {}).get(nama)
    if u:
        w, h = u
    return w * k / 2, h * k / 2


def ukuran_peta(L, pos, setengah_):
    if L['peta']:
        return L['peta']
    x0 = min(x - setengah_[i][0] for i, (x, y, _) in pos.items())
    x1 = max(x + setengah_[i][0] for i, (x, y, _) in pos.items())
    y0 = min(y - setengah_[i][1] for i, (x, y, _) in pos.items())
    y1 = max(y + setengah_[i][1] for i, (x, y, _) in pos.items())
    lebar = 2 * max(-x0, x1) + 2 * L['tepi']
    return [round(lebar), round(y1 - y0 + 2 * L['tepi']), round((y0 + y1) / 2)]


def svg(nama, L, pos, sisi, sh, peta, ind, laporan):
    W, H, CY = peta
    fs = L['label']
    out = [f'{ind}<svg class="dg peta-garis peta-{nama}" viewBox="{-W // 2} {CY - H // 2} {W} {H}" aria-hidden="true" focusable="false">',
           f'{ind}  <g>']
    for a, b, _ in sisi:
        (x1, y1, _k), (x2, y2, _k2) = pos[a], pos[b]
        out.append(f'{ind}    <path class="dg-edge dotted a-flow" d="M{x1} {y1} L{x2} {y2}"/>')
    out += [f'{ind}  </g>', f'{ind}  <g>']

    def keluar(id, dx, dy):
        hw, hh = sh[id]
        dx, dy = abs(dx), abs(dy)
        return min(hw / dx if dx else 9, hh / dy if dy else 9)

    for a, b, t in sisi:
        (x1, y1, _k), (x2, y2, _k2) = pos[a], pos[b]
        # Label di tengah celah yang terlihat: dari titik garis keluar blok asal
        # sampai titik garis masuk blok tujuan.
        t0 = keluar(a, x2 - x1, y2 - y1)
        t1 = 1 - keluar(b, x2 - x1, y2 - y1)
        f = (t0 + t1) / 2
        mx, my = round(x1 + (x2 - x1) * f), round(y1 + (y2 - y1) * f)
        w = round(len(t) * fs * .56 + fs * 1.2)
        h = round(fs * 1.7)
        L = math.hypot(x2 - x1, y2 - y1)
        celah = round((t1 - t0) * L)
        # Label selalu mendatar: di garis mendatar yang dibutuhkan lebarnya, di
        # garis tegak tingginya, di garis miring proyeksi keduanya ke garis.
        butuh = round(abs(x2 - x1) / L * w + abs(y2 - y1) / L * h) + 80
        if celah < butuh:
            laporan.append(f'SEMPIT  {nama}: label "{t}" ({a} → {b}) butuh {butuh}, celah {celah}')
        out.append(f'{ind}    <g class="dg-label" transform="translate({mx} {my})"><rect x="{-w // 2}" y="{-h // 2}" width="{w}" height="{h}" rx="{h // 2}"/><text>{t}</text></g>')
    out += [f'{ind}  </g>', f'{ind}</svg>']
    return out


def cek_tumpang(nama, pos, sh, laporan):
    ids = list(pos)
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = ids[i], ids[j]
            if abs(pos[a][0] - pos[b][0]) < sh[a][0] + sh[b][0] + 40 and abs(pos[a][1] - pos[b][1]) < sh[a][1] + sh[b][1] + 40:
                laporan.append(f'TUMPANG {nama}: #{a} dan #{b}')


def aturan(pos, ind):
    w = max(len(i) for i in pos) + 1
    return '\n'.join(f'{ind}#{i}{" " * (w - len(i))}{{ --croot-x: {x}; --croot-y: {y};'
                     f'{f" --croot-scale: {k};" if k != 1 else ""} }}' for i, (x, y, k) in pos.items())


def buat(spek_p):
    """Hitung hasil tanpa menulis apa pun.

    Mengembalikan (berkas, laporan, info): berkas = {path: isi baru},
    laporan = daftar TUMPANG/SEMPIT, info = ringkasan untuk dicetak.
    Bisa dipakai dari skrip lain: import peta; peta.buat('peta.json').
    """
    dasar = os.path.dirname(os.path.abspath(spek_p))
    spek = baca_spek(spek_p)
    html_p, css_p = os.path.join(dasar, spek['html']), os.path.join(dasar, spek['css'])
    html = open(html_p, encoding='utf-8').read()
    peta_id = spek['peta']

    hasil, laporan = {}, []
    for nama in ('desktop', 'ponsel'):
        L = gabung(BAWAAN[nama], spek.get(nama))
        pos, sisi = susun(spek, L)
        sh = {i: setengah(spek, html, nama, L, i, k) for i, (_x, _y, k) in pos.items()}
        cek_tumpang(nama, pos, sh, laporan)
        hasil[nama] = (L, pos, sisi, sh, ukuran_peta(L, pos, sh))

    # HTML: garis di antara penanda; posisi blok pindah dari atribut ke CSS
    # supaya desktop dan ponsel bisa berbeda.
    m = re.search(r'\n([ \t]*)<!-- peta:garis -->.*?<!-- /peta:garis -->', html, re.S)
    if not m:
        sys.exit(f'Tambahkan <!-- peta:garis --><!-- /peta:garis --> di dalam node #{peta_id} di {spek["html"]}')
    ind = m.group(1)
    baris = [f'{ind}<!-- peta:garis -->']
    for nama, (L, pos, sisi, sh, peta) in hasil.items():
        baris += svg(nama, L, pos, sisi, sh, peta, ind, laporan)
    baris.append(f'{ind}<!-- /peta:garis -->')
    html = html[:m.start()] + '\n' + '\n'.join(baris) + html[m.end():]
    for id in hasil['desktop'][1]:
        html = re.sub(r'(<\w+[^>]*\bid="%s"[^>]*?)>' % re.escape(id),
                      lambda t: re.sub(r' data-croot-(x|y|scale)="[^"]*"', '', t.group(1)) + '>', html, count=1)

    Ld, pd, _s, _h, Pd = hasil['desktop']
    Lp, pp, _s2, _h2, Pp = hasil['ponsel']
    blok = f'''{CSS_MULAI}
/* Node big picture mencakup seluruh peta dan berada sedikit di belakang blok. */
#{peta_id} {{ --croot-y: {Pd[2]}; --croot-z: -40; }}
.croot-ready #{peta_id} {{ width: {Pd[0]}px; height: {Pd[1]}px; }}
.peta-garis {{ position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; --dg-gap: {Ld['titik']}px; }}
.peta-garis .dg-edge {{ stroke-width: {Ld['garis']}; }}
.peta-desktop .dg-label text {{ font-size: {Ld['label']}px; }}
.peta-ponsel .dg-label text {{ font-size: {Lp['label']}px; }}
.peta-ponsel, .croot-viewport:not(.croot-ready) .peta-garis {{ display: none; }}
/* Saat peta utuh tampil, semua blok terlihat jelas (tidak diredupkan) */
.croot-ready:has(#{peta_id}.croot-active) .croot-node {{ opacity: 1; }}
{aturan(pd, '')}

@media (max-width: 640px) {{
  #{peta_id} {{ --croot-y: {Pp[2]}; }}
  .croot-ready #{peta_id} {{ width: {Pp[0]}px; height: {Pp[1]}px; }}
  .peta-garis {{ --dg-gap: {Lp['titik']}px; }}
  .peta-garis .dg-edge {{ stroke-width: {Lp['garis']}; }}
  .croot-ready .peta-ponsel {{ display: block; }}
  .peta-desktop {{ display: none; }}
{aturan(pp, '  ')}
}}
{CSS_AKHIR}
'''
    css = open(css_p, encoding='utf-8').read() if os.path.exists(css_p) else ''
    if CSS_MULAI.split(' (')[0] in css:
        a = css.index(CSS_MULAI.split(' (')[0])
        b = css.index(CSS_AKHIR, a) + len(CSS_AKHIR)
        css = css[:a] + blok.rstrip('\n') + css[b:]
    else:
        css = css + ('\n' if css and not css.endswith('\n') else '') + blok
    info = [f'{len(pd)} blok, {len(hasil["desktop"][2])} hubungan → {spek["html"]}, {spek["css"]}',
            f'peta desktop {Pd[0]}x{Pd[1]} (y {Pd[2]}), ponsel {Pp[0]}x{Pp[1]} (y {Pp[2]})']
    return {html_p: html, css_p: css}, laporan, info


def main():
    args = [a for a in sys.argv[1:] if a != '--cek']
    cek = '--cek' in sys.argv[1:]
    if len(args) != 1:
        sys.exit(__doc__)
    berkas, laporan, info = buat(args[0])
    beda = [p for p, isi in berkas.items()
            if not os.path.exists(p) or open(p, encoding='utf-8').read() != isi]
    if cek:
        # Mode CI: tidak menulis apa pun; gagal bila berkas belum sesuai peta.json.
        for p in beda:
            print(f'BEDA    {os.path.relpath(p)} belum sesuai peta.json; jalankan peta.py tanpa --cek')
    else:
        for p in beda:
            open(p, 'w', encoding='utf-8').write(berkas[p])
        for l in info:
            print(l)
    for l in laporan:
        print(l)
    if laporan or (cek and beda):
        sys.exit(1)
    if cek:
        print('peta sesuai peta.json')


if __name__ == '__main__':
    main()
