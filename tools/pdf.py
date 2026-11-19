#!/usr/bin/env python3
"""Ekspor deck crootss ke PDF tanpa dialog cetak.

Menyajikan folder deck di server lokal sementara, lalu mencetaknya dengan
Chrome/Edge/Chromium headless yang sudah terpasang. Hasilnya sama dengan
Ctrl+P → Simpan sebagai PDF: satu langkah per halaman 1280×720. Cocok untuk
CI atau untuk membangun PDF otomatis.

    python3 pdf.py                    # deck di folder ini → <nama-folder>.pdf
    python3 pdf.py slide/ hasil.pdf
    CHROME=/path/ke/chrome python3 pdf.py

Tanpa menyalin berkasnya:

    curl -s https://raw.githubusercontent.com/crootss/crootss/main/tools/pdf.py | python3 - slide/

Butuh crootss v0.6.0 ke atas (parameter ?print=pdf). Hanya pustaka standar
Python 3.
"""
import base64
import functools
import glob
import http.server
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request

KANDIDAT = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome',
            'msedge', 'microsoft-edge', 'microsoft-edge-stable']
LOKASI = [
    r'%ProgramFiles%\Google\Chrome\Application\chrome.exe',
    r'%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe',
    r'%LocalAppData%\Google\Chrome\Application\chrome.exe',
    r'%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe',
    r'%ProgramFiles%\Microsoft\Edge\Application\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
]


def cari_chrome():
    if os.environ.get('CHROME'):
        return os.environ['CHROME']
    for n in KANDIDAT:
        p = shutil.which(n)
        if p:
            return p
    for p in LOKASI:
        p = os.path.expandvars(p)
        if os.path.isfile(p):
            return p
    # Chromium dari Playwright, bila ada (chrome-headless-shell lebih dulu)
    for pola in ('~/.cache/ms-playwright/chromium_headless_shell-*/chrome-*/chrome-headless-shell',
                 '~/.cache/ms-playwright/chromium-*/chrome-*/chrome'):
        for p in sorted(glob.glob(os.path.expanduser(pola)), reverse=True):
            return p
    sys.exit('Chrome/Edge/Chromium tidak ditemukan. Pasang salah satunya, atau isi variabel CHROME.')


class Penyaji(http.server.SimpleHTTPRequestHandler):
    # ES module wajib dikirim dengan Content-Type JavaScript.
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
                      '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json'}

    def log_message(self, *a):
        pass


class CDP:
    """Klien Chrome DevTools Protocol minimal lewat WebSocket (pustaka standar)."""

    def __init__(self, ws_url):
        u = urllib.parse.urlsplit(ws_url)
        self.sock = socket.create_connection((u.hostname, u.port), timeout=120)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f'GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\n'
                           f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        head = b''
        while b'\r\n\r\n' not in head:
            head += self.sock.recv(1)
        if b' 101 ' not in head.split(b'\r\n', 1)[0]:
            raise RuntimeError('WebSocket DevTools ditolak: ' + head.decode(errors='replace'))
        self.id = 0

    def _kirim(self, teks):
        data = teks.encode()
        n = len(data)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack('>H', n)
                                if n < 65536 else bytes([0x80 | 127]) + struct.pack('>Q', n))
        mask = os.urandom(4)  # klien wajib menyamarkan frame
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _baca(self, n):
        buf = b''
        while len(buf) < n:
            part = self.sock.recv(n - len(buf))
            if not part:
                raise RuntimeError('Koneksi DevTools terputus')
            buf += part
        return buf

    def _terima(self):
        pesan = b''
        while True:
            b0, b1 = self._baca(2)
            n = b1 & 0x7f
            if n == 126:
                n = struct.unpack('>H', self._baca(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._baca(8))[0]
            pesan += self._baca(n)
            if b0 & 0x80:
                return json.loads(pesan)

    def panggil(self, method, **params):
        self.id += 1
        self._kirim(json.dumps({'id': self.id, 'method': method, 'params': params}))
        while True:
            m = self._terima()
            if m.get('id') == self.id:
                if 'error' in m:
                    raise RuntimeError(f'{method}: {m["error"]}')
                return m.get('result', {})


def jalankan_chrome(chrome, profil, sandbox=True):
    perintah = [chrome, '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                f'--user-data-dir={profil}', '--remote-debugging-port=0', '--hide-scrollbars',
                # Deck disajikan dari 127.0.0.1: jangan lewat proxy sistem (deteksi
                # proxy otomatis bisa membuat navigasi menggantung).
                '--no-proxy-server',
                # Profil baru di Linux menunggu keyring desktop (D-Bus) sebelum
                # permintaan jaringan pertama; tanpa ini navigasi bisa macet.
                '--password-store=basic', '--use-mock-keychain',
                '--disable-background-networking', '--disable-component-update', '--disable-sync',
                'about:blank']
    if 'headless-shell' not in os.path.basename(chrome):
        perintah.insert(1, '--headless=new')
    if not sandbox:
        perintah.insert(1, '--no-sandbox')
    # stderr ke berkas, bukan pipa: Chrome banyak menulis log dan akan macet
    # bila pipanya penuh tanpa dibaca.
    log = open(os.path.join(profil, 'chrome.log'), 'wb')
    proc = subprocess.Popen(perintah, stdout=subprocess.DEVNULL, stderr=log)
    port_file = os.path.join(profil, 'DevToolsActivePort')
    for _ in range(300):
        if os.path.exists(port_file) and open(port_file).read().strip():
            return proc, int(open(port_file).read().split()[0])
        if proc.poll() is not None:
            return proc, None
        time.sleep(.1)
    proc.kill()
    return proc, None


def main():
    args = sys.argv[1:]
    deck = os.path.abspath(args[0] if args else '.')
    if not os.path.isfile(os.path.join(deck, 'index.html')):
        sys.exit(f'{deck} tidak berisi index.html')
    keluar = os.path.abspath(args[1] if len(args) > 1 else os.path.basename(deck.rstrip(os.sep)) + '.pdf')

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Penyaji, directory=deck))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_address[1]}/?print=pdf'

    chrome = cari_chrome()
    profil = tempfile.mkdtemp(prefix='crootss-pdf-')
    proc = None
    try:
        proc, port = jalankan_chrome(chrome, profil)
        if port is None:
            err = open(os.path.join(profil, 'chrome.log'), errors='replace').read()
            if 'No usable sandbox' not in err:
                sys.exit(f'Gagal menjalankan {chrome}:\n{err[-2000:]}')
            # Ubuntu 23.10+ memblokir sandbox Chromium yang tidak dipasang lewat
            # paket resmi. Yang dimuat hanya deck sendiri dari 127.0.0.1.
            print('Sandbox Chromium tidak tersedia di sistem ini; memakai --no-sandbox.')
            proc, port = jalankan_chrome(chrome, profil, sandbox=False)
            if port is None:
                sys.exit(f'Gagal menjalankan {chrome}')
        targets = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list'))
        page = next(t for t in targets if t.get('type') == 'page')
        cdp = CDP(page['webSocketDebuggerUrl'])
        cdp.panggil('Page.enable')
        cdp.panggil('Page.navigate', url=url)
        # croot.js memasang <html data-croot-print="siap"> setelah font, gambar,
        # dan halaman cetak siap (?print=pdf).
        batas = time.time() + 90
        while True:
            r = cdp.panggil('Runtime.evaluate', expression="document.documentElement.getAttribute('data-croot-print')", returnByValue=True)
            if r.get('result', {}).get('value') == 'siap':
                break
            if time.time() > batas:
                sys.exit('Deck tidak siap dicetak dalam 90 detik. Pastikan memakai crootss v0.6.0 ke atas.')
            time.sleep(.3)
        pdf = cdp.panggil('Page.printToPDF', preferCSSPageSize=True, printBackground=True,
                          displayHeaderFooter=False, marginTop=0, marginBottom=0, marginLeft=0, marginRight=0)
        open(keluar, 'wb').write(base64.b64decode(pdf['data']))
    finally:
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(10)
            except subprocess.TimeoutExpired:
                proc.kill()
        server.shutdown()
        shutil.rmtree(profil, ignore_errors=True)
    print(f'PDF: {keluar}')


if __name__ == '__main__':
    main()
