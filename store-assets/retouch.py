#!/usr/bin/env python3
"""Replace the side panel in the original store photos with the current UI.

Usage (from the repo root):  python3 store-assets/retouch.py
Inputs : 上架宣傳圖片/1280-800-<type>-1(原始).png  (2880×1800 retina photos)
Output : 上架宣傳圖片/v1.6/photo-<type>.png         (1280×800, RGB, no alpha)

Only the extension's area inside Chrome's side panel is replaced; the rest of
each photo (Google editor, browser chrome, Chrome's panel title bar) is kept.
The panel is the real popup.html in demo mode, rendered at the photo's 2×
resolution, set to the same file, title, target language and state.
"""
import http.server, os, socketserver, subprocess, tempfile, threading, time
from functools import partial
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '上架宣傳圖片')
OUT = os.path.join(SRC, 'v1.6')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PORT = 8797
# Extension area inside Chrome's side panel, in the 2880×1800 photos (measured).
BOX = (2142, 254, 2860, 1782)          # left, top, right, bottom (px)
RADIUS = 36                            # Chrome rounds the panel's bottom corners
DPR = 2                                # photos are 2× retina captures

PHOTOS = [
    ('slide', 'presentation', 'Google_IO_2026', 'vi', 'progress'),
    ('doc', 'document', 'Hezbollah rejects renewed ceasefire agreed by Israel and Lebanon', 'zh-TW', 'progress'),
    ('sheets', 'spreadsheet', 'Projektcontrolling_Tabelle', 'en', 'done'),
    ('form', 'form', '高級ファッションブランドに関する消費者調査', 'es', 'progress'),
]


def serve():
    handler = partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    handler.log_message = lambda *a: None
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def render_panel(ftype, title, lang, state, w, h):
    from urllib.parse import urlencode
    q = urlencode({'demo': state, 'ui': 'en', 'type': ftype, 'title': title, 'lang': lang, 'w': w, 'h': h})
    out = tempfile.mktemp(suffix='.png')
    subprocess.run([
        CHROME, '--headless=new', '--hide-scrollbars', f'--force-device-scale-factor={DPR}',
        f'--window-size={max(w, 520)},{h}', '--virtual-time-budget=6000',
        f'--screenshot={out}', f'http://127.0.0.1:{PORT}/store-assets/panel-frame.html?{q}',
    ], check=True, capture_output=True, timeout=120)
    img = Image.open(out).convert('RGB').crop((0, 0, w * DPR, h * DPR))
    os.remove(out)
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    left, top, right, bottom = BOX
    bw, bh = right - left, bottom - top
    httpd = serve()
    try:
        time.sleep(0.3)
        for key, ftype, title, lang, state in PHOTOS:
            photo = Image.open(os.path.join(SRC, f'1280-800-{key}-1(原始).png')).convert('RGB')
            panel = render_panel(ftype, title, lang, state, round(bw / DPR), round(bh / DPR)).resize((bw, bh), Image.LANCZOS)
            mask = Image.new('L', (bw, bh), 0)
            ImageDraw.Draw(mask).rounded_rectangle((0, -RADIUS, bw - 1, bh - 1), RADIUS, fill=255)
            photo.paste(panel, (left, top), mask)
            final = photo.resize((1280, 800), Image.LANCZOS)
            path = os.path.join(OUT, f'photo-{key}.png')
            final.save(path, 'PNG', optimize=True)
            check = Image.open(path)
            assert check.size == (1280, 800) and check.mode == 'RGB'
            print(f'photo-{key}.png: 1280x800 RGB')
    finally:
        httpd.shutdown()


if __name__ == '__main__':
    main()
