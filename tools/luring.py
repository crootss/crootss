#!/usr/bin/env python3
"""Paket luring (tanpa internet) untuk deck crootss.

Menyalin folder deck, mengunduh semua yang dimuat dari internet (crootss,
tema, font Google, impor JS dari CDN, gambar) ke folder vendor/, lalu
mengganti alamatnya ke salinan lokal. Jalankan sekali saat masih online:

    python3 luring.py                 # deck di folder ini → ../<nama>-luring
    python3 luring.py slide/ paket/   # deck di slide/ → paket/

Hasilnya cukup dibuka lewat server lokal yang juga ikut disalin, tanpa
internet sama sekali:

    PowerShell:  powershell -ExecutionPolicy Bypass -File serve.ps1
    Python:      python3 -m http.server 8080

Hanya pustaka standar Python 3. Tautan biasa (<a href>, canonical, Open
Graph) tidak diubah karena bukan bagian dari tampilan slide.
"""
import hashlib
import os
import posixpath
import re
import shutil
import sys
import urllib.parse
import urllib.request

# Google Fonts mengirim woff2 hanya ke browser modern.
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
SERVE_PS1 = 'https://crootss.if.co.id/serve.ps1'
TEKS = ('.html', '.htm', '.css', '.js', '.mjs')
LEWATI = {'.git', 'node_modules', '__pycache__'}

# Konteks yang memuat aset. Grup "u" = alamatnya.
POLA = {
    'html': [
        r'<link\b(?=[^>]*\brel=["\'][^"\']*\b(?:stylesheet|modulepreload|preload|icon|manifest)\b)[^>]*?\bhref=["\'](?P<u>[^"\']+)',
        r'<(?:script|img|source|video|audio|track|iframe|embed)\b[^>]*?\bsrc=["\'](?P<u>[^"\']+)',
        r'<video\b[^>]*?\bposter=["\'](?P<u>[^"\']+)',
    ],
    'css': [
        r'@import\s+"(?P<u>[^"]+)"',
        r"@import\s+'(?P<u>[^']+)'",
        r'url\(\s*"(?P<u>[^"]+)"\s*\)',
        r"url\(\s*'(?P<u>[^']+)'\s*\)",
        r'url\(\s*(?P<u>[^"\'\s)]+)\s*\)',
    ],
    'js': [
        r'\b(?:import|export)\b[^;\'"]*?\bfrom\s*["\'](?P<u>[^"\']+)["\']',
        r'\bimport\s*["\'](?P<u>[^"\']+)["\']',
        r'\bimport\(\s*["\'](?P<u>[^"\']+)["\']\s*\)',
    ],
}


def jenis(path):
    ext = os.path.splitext(path)[1].lower()
    return 'html' if ext in ('.html', '.htm') else 'css' if ext == '.css' else 'js' if ext in ('.js', '.mjs') else None


class Paket:
    def __init__(self, deck, keluar):
        self.deck = deck
        self.keluar = keluar
        self.luar = []
        self.vendor = os.path.join(keluar, 'vendor')
        self.selesai = {}   # url → path lokal
        self.gagal = []

    def lokal_untuk(self, url):
        p = urllib.parse.urlsplit(url)
        path = p.path.lstrip('/') or 'index'
        if p.query:
            # mis. fonts.googleapis.com/css2?family=… → css2-<hash>.css
            root, ext = posixpath.splitext(path)
            path = f'{root}-{hashlib.sha1(p.query.encode()).hexdigest()[:10]}{ext or ".css"}'
        return os.path.join(self.vendor, p.netloc, *path.split('/'))

    def unduh(self, url, wajib=True):
        if url in self.selesai:
            return self.selesai[url]
        tujuan = self.lokal_untuk(url)
        self.selesai[url] = tujuan
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
                ctype = r.headers.get('Content-Type', '')
        except Exception as e:  # jaringan putus, 404, dll.
            if wajib:
                self.gagal.append(f'{url} ({e})')
            else:
                print(f'  lewati {url} ({e})')
            return None
        if 'text/css' in ctype and not tujuan.endswith('.css'):
            tujuan += '.css'
            self.selesai[url] = tujuan
        os.makedirs(os.path.dirname(tujuan), exist_ok=True)
        open(tujuan, 'wb').write(data)
        print('  unduh', url)
        if jenis(tujuan):
            self.olah(tujuan, url)
        return tujuan

    def olah(self, path, basis=None):
        """Ganti alamat aset di satu file. basis = URL asal bila file ini unduhan."""
        j = jenis(path)
        teks = open(path, encoding='utf-8', errors='surrogateescape').read()

        def ganti(u):
            """Alamat baru untuk u, atau None bila tidak diubah."""
            if u.startswith(('data:', '#', '%23', 'mailto:')) or '...' in u or '…' in u:
                return None
            if u.startswith('//'):
                u = 'https:' + u
            if not re.match(r'https?://', u):
                if basis:
                    # Rujukan relatif di dalam file unduhan (mis. ./base.css):
                    # unduh juga; strukturnya sama di vendor/, alamatnya tetap.
                    self.unduh(urllib.parse.urljoin(basis, u), wajib=False)
                else:
                    target = os.path.normpath(os.path.join(os.path.dirname(path), urllib.parse.urlsplit(u).path))
                    if os.path.commonpath([target, self.keluar]) != self.keluar:
                        self.luar.append(f'{os.path.relpath(path, self.keluar)}: {u}')
                return None
            lokal = self.unduh(u)
            if not lokal:
                return None
            rel = os.path.relpath(lokal, os.path.dirname(path)).replace(os.sep, '/')
            if j == 'js' and not rel.startswith('.'):
                rel = './' + rel  # impor ES module wajib diawali ./ atau ../
            return rel

        # Satu lintasan: setiap alamat diproses sekali walau cocok di beberapa pola.
        temuan = {}
        for pola in POLA[j]:
            for m in re.finditer(pola, teks, flags=re.I):
                temuan.setdefault(m.span('u'), m.group('u'))
        baru = teks
        for (a, b), u in sorted(temuan.items(), reverse=True):
            r = ganti(u)
            if r is not None:
                baru = baru[:a] + r + baru[b:]
        if baru != teks:
            open(path, 'w', encoding='utf-8', errors='surrogateescape').write(baru)


def main():
    deck = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
    keluar = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else deck.rstrip(os.sep) + '-luring')
    if not os.path.isfile(os.path.join(deck, 'index.html')):
        sys.exit(f'{deck} tidak berisi index.html')
    if os.path.commonpath([deck, keluar]) == deck:
        sys.exit('Folder keluaran tidak boleh berada di dalam folder deck')
    if os.path.exists(keluar):
        shutil.rmtree(keluar)
    shutil.copytree(deck, keluar, ignore=lambda d, names: [n for n in names if n in LEWATI])
    print(f'Salin {deck} → {keluar}')

    pk = Paket(deck, keluar)
    for akar, dirs, files in os.walk(keluar):
        if os.path.commonpath([akar, pk.vendor]) == pk.vendor:
            continue
        for f in files:
            if f.lower().endswith(TEKS):
                pk.olah(os.path.join(akar, f))

    if not os.path.exists(os.path.join(keluar, 'serve.ps1')):
        try:
            req = urllib.request.Request(SERVE_PS1, headers={'User-Agent': UA})
            open(os.path.join(keluar, 'serve.ps1'), 'wb').write(urllib.request.urlopen(req, timeout=60).read())
        except Exception as e:
            pk.gagal.append(f'{SERVE_PS1} ({e})')
    open(os.path.join(keluar, 'BACA-LURING.txt'), 'w', encoding='utf-8').write(
        'Deck ini bisa dibuka tanpa internet. Jalankan salah satu di folder ini,\n'
        'lalu buka http://localhost:8080/ di browser:\n\n'
        '  PowerShell (Windows):  powershell -ExecutionPolicy Bypass -File serve.ps1\n'
        '  Python:                python3 -m http.server 8080   (di Windows: python)\n\n'
        'Jangan membuka index.html langsung (file://): browser menolak memuat\n'
        'ES module dari file lokal.\n')

    print(f'{len(pk.selesai)} file diunduh ke {os.path.join(os.path.basename(keluar), "vendor")}')
    for l in pk.luar:
        print('PERINGATAN rujukan di luar folder deck (tidak ikut terbawa):', l)
    for g in pk.gagal:
        print('GAGAL', g)
    if pk.gagal:
        sys.exit(1)


if __name__ == '__main__':
    main()
