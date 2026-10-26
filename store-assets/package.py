#!/usr/bin/env python3
"""Build the Chrome Web Store upload: dist/workspace-translator-pro-<version>.zip

Usage (from the repo root):  python3 store-assets/package.py
- Ships only runtime files (no tests, docs, store-assets, dev scripts, QA locale).
- Removes manifest "key" (the store assigns the ID; the key is for local dev).
- Verifies every import / src / href the shipped files reference is inside the zip.
"""
import json, os, re, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME = [
    'manifest.json', 'background.js', 'translate.js',
    'popup.html', 'popup.css', 'popup.js',
    'onboarding.html', 'onboarding.css', 'onboarding.js',
    'privacy-policy.html',
    'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png',
    'i18n/i18n.js', 'i18n/languages.js',
]
RUNTIME_DIRS = [('lib', '.js'), ('i18n/locales', '.json')]
EXCLUDE = {'i18n/locales/qa.json'}


def collect():
    files = list(RUNTIME)
    for d, ext in RUNTIME_DIRS:
        for name in sorted(os.listdir(os.path.join(ROOT, d))):
            rel = f'{d}/{name}'
            if name.endswith(ext) and rel not in EXCLUDE:
                files.append(rel)
    return files


def references(rel, text):
    base = os.path.dirname(rel)
    refs = []
    if rel.endswith('.js'):
        refs += re.findall(r"""(?:import|from)\s*['"](\.{1,2}/[^'"]+)['"]""", text)
    if rel.endswith('.html'):
        refs += [r for r in re.findall(r'(?:src|href)="([^"#:?]+)"', text) if not r.startswith('//')]
    return [os.path.normpath(os.path.join(base, r)) for r in refs]


def main():
    manifest = json.load(open(os.path.join(ROOT, 'manifest.json'), encoding='utf-8'))
    version = manifest['version']
    manifest.pop('key', None)
    files = collect()

    missing = []
    for rel in files:
        if rel.endswith(('.js', '.html')):
            for ref in references(rel, open(os.path.join(ROOT, rel), encoding='utf-8').read()):
                if ref not in files:
                    missing.append(f'{rel} → {ref}')
    for p in [manifest['background']['service_worker'], manifest['side_panel']['default_path'], *manifest['icons'].values()]:
        if p not in files:
            missing.append(f'manifest → {p}')
    if missing:
        sys.exit('Missing from package:\n  ' + '\n  '.join(missing))

    os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
    out = os.path.join(ROOT, 'dist', f'workspace-translator-pro-{version}.zip')
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        for rel in files:
            if rel != 'manifest.json':
                z.write(os.path.join(ROOT, rel), rel)
    print(f'{out}\n{len(files)} files, {os.path.getsize(out) // 1024} KB, version {version}, key removed')


if __name__ == '__main__':
    main()
