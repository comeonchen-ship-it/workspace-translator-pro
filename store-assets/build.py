#!/usr/bin/env python3
"""Render the Chrome Web Store images from store-assets/compose.html.

Usage (from the repo root):  python3 store-assets/build.py
Output: 上架宣傳圖片/v1.6/ — exact store sizes, 24-bit PNG (no alpha channel,
which the store rejects for promo images).
Needs Google Chrome and Pillow.
"""
import http.server, os, socketserver, subprocess, sys, threading, time
from functools import partial
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, '上架宣傳圖片', 'v1.6')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PORT = 8799
SHOTS = [
    ('1', 1280, 800, 'screenshot-1-translate.png'),
    ('2', 1280, 800, 'screenshot-2-setup.png'),
    ('3', 1280, 800, 'screenshot-3-preferences.png'),
    ('4', 1280, 800, 'screenshot-4-languages.png'),
    ('5', 1280, 800, 'screenshot-5-background.png'),
    ('marquee', 1400, 560, 'marquee-1400x560.png'),
    ('tile', 440, 280, 'small-tile-440x280.png'),
]
PANEL = os.path.join(ROOT, '_store_panel.html')


def write_panel_page():
    # The real side panel with the screenshot stub injected before popup.js.
    html = open(os.path.join(ROOT, 'popup.html'), encoding='utf-8').read()
    tag = '<script src="popup.js" type="module"></script>'
    assert tag in html, 'popup.html changed: update build.py'
    html = html.replace(tag, '<script src="store-assets/panel-stub.js"></script>\n' + tag)
    open(PANEL, 'w', encoding='utf-8').write(html)


def serve():
    handler = partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    handler.log_message = lambda *a: None
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def render(shot, w, h, name):
    path = os.path.join(OUT, name)
    url = f'http://127.0.0.1:{PORT}/store-assets/compose.html?shot={shot}'
    subprocess.run([
        CHROME, '--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1',
        f'--window-size={w},{h}', '--virtual-time-budget=6000', '--default-background-color=0b0c12ff',
        f'--screenshot={path}', url,
    ], check=True, capture_output=True, timeout=120)
    img = Image.open(path)
    if img.size != (w, h):
        img = img.crop((0, 0, w, h))
    img.convert('RGB').save(path, 'PNG', optimize=True)  # drop alpha
    check = Image.open(path)
    assert check.size == (w, h) and check.mode == 'RGB', (name, check.size, check.mode)
    print(f'{name}: {w}x{h} RGB')


def main():
    os.makedirs(OUT, exist_ok=True)
    write_panel_page()
    httpd = serve()
    try:
        time.sleep(0.3)
        only = set(sys.argv[1:])
        for shot, w, h, name in SHOTS:
            if not only or shot in only:
                render(shot, w, h, name)
    finally:
        httpd.shutdown()
        os.remove(PANEL)


if __name__ == '__main__':
    main()
