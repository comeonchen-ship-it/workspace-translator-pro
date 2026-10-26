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

import json
# Each photo: the side panel shows the chosen language and one feature (outlined),
# and a caption card names the language first, then the feature.
PHOTOS = [
    dict(key='slide', accent='#e37400', lang_name='Tiếng Việt', panel=dict(
            demo='main', type='presentation', title='Google_IO_2026', lang='vi', range='3-8'),
         title='Pick the language — and the slides',
         sub='Translate the whole deck or only slides\u00a03\u20118. Every layout stays exactly as it was.'),
    dict(key='doc', accent='#1a73e8', lang_name='繁體中文', panel=dict(
            demo='prefs', type='document', title='Hezbollah rejects renewed ceasefire agreed by Israel and Lebanon',
            lang='zh-TW', tone='formal',
            names=json.dumps({'people': 'keep', 'brands': 'keep', 'places': 'translate'}),
            terms=json.dumps([{'src': 'Hezbollah', 'mode': 'keep', 'dst': ''},
                              {'src': 'ceasefire', 'mode': 'translate', 'dst': '停火'}], ensure_ascii=False)),
         title='Names stay as they are',
         sub='Keep people’s and brand names, translate places — the AI spots names by itself.'),
    dict(key='sheets', accent='#188038', lang_name='English', panel=dict(
            demo='prefs', type='spreadsheet', title='Projektcontrolling_Tabelle', lang='en', scroll='result'),
         title='Longer text still fits',
         sub='Columns widen and slide fonts shrink automatically — and the translated copy opens as soon as it’s ready.'),
    dict(key='form', accent='#7248b9', lang_name='Español', panel=dict(
            demo='prefs', type='form', title='高級ファッションブランドに関する消費者調査', lang='es', scroll='terms',
            terms=json.dumps([{'src': 'ブランド', 'mode': 'translate', 'dst': 'marca'},
                              {'src': 'Gucci', 'mode': 'keep', 'dst': ''}], ensure_ascii=False)),
         title='Your words, every time',
         sub='Set fixed translations for your own terms — e.g. ブランド\u00a0→\u00a0marca — or keep a word untranslated.'),
]
CAPTION_CSS = (560, 300)               # caption page size in CSS px (card sits bottom-left)
PHOTO_CSS_SCALE = 2.25                 # 2880-px photo ÷ 1280-px output


def serve():
    handler = partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    handler.log_message = lambda *a: None
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def render_panel(panel, w, h):
    from urllib.parse import urlencode
    q = urlencode({**panel, 'ui': 'en', 'w': w, 'h': h})
    out = tempfile.mktemp(suffix='.png')
    subprocess.run([
        CHROME, '--headless=new', '--hide-scrollbars', f'--force-device-scale-factor={DPR}',
        f'--window-size={max(w, 520)},{h}', '--virtual-time-budget=6000',
        f'--screenshot={out}', f'http://127.0.0.1:{PORT}/store-assets/panel-frame.html?{q}',
    ], check=True, capture_output=True, timeout=120)
    img = Image.open(out).convert('RGB').crop((0, 0, w * DPR, h * DPR))
    os.remove(out)
    return img


def render_caption(photo_def):
    from urllib.parse import urlencode
    cw, ch = CAPTION_CSS
    q = urlencode({'lang': photo_def['lang_name'], 'title': photo_def['title'], 'sub': photo_def['sub'], 'accent': photo_def['accent']})
    out = tempfile.mktemp(suffix='.png')
    subprocess.run([
        CHROME, '--headless=new', '--hide-scrollbars', f'--force-device-scale-factor={PHOTO_CSS_SCALE}',
        f'--window-size={cw},{ch}', '--virtual-time-budget=3000', '--default-background-color=00000000',
        f'--screenshot={out}', f'http://127.0.0.1:{PORT}/store-assets/caption.html?{q}',
    ], check=True, capture_output=True, timeout=120)
    img = Image.open(out).convert('RGBA').crop((0, 0, round(cw * PHOTO_CSS_SCALE), round(ch * PHOTO_CSS_SCALE)))
    os.remove(out)
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    left, top, right, bottom = BOX
    bw, bh = right - left, bottom - top
    httpd = serve()
    try:
        time.sleep(0.3)
        for d in PHOTOS:
            key = d['key']
            photo = Image.open(os.path.join(SRC, f'1280-800-{key}-1(原始).png')).convert('RGB')
            panel = render_panel(d['panel'], round(bw / DPR), round(bh / DPR)).resize((bw, bh), Image.LANCZOS)
            mask = Image.new('L', (bw, bh), 0)
            ImageDraw.Draw(mask).rounded_rectangle((0, -RADIUS, bw - 1, bh - 1), RADIUS, fill=255)
            photo.paste(panel, (left, top), mask)
            # Plain product shots: no caption, no highlight (render_caption kept for reuse).
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
