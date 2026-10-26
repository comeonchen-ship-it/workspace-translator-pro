# Chrome Web Store — v1.7.0 submission

Upload package: `dist/workspace-translator-pro-1.7.0.zip` (build with `python3 store-assets/package.py`).
Images: `上架宣傳圖片/v1.7/` (rebuild with `python3 store-assets/build.py`).

## Store listing tab

**Short description** (max 132 characters)

> Translate Google Slides, Docs, Sheets & Forms into 10 languages with AI. Layout kept, original untouched.

**Detailed description**

```
Translate a whole Google Slides deck, Doc, Sheet or Form in a few clicks — Workspace Translator Pro creates a translated copy and keeps your layout, formatting, images and tables. Your original file is never modified.

HOW IT WORKS
1. Open a file in Google Slides, Docs, Sheets or Forms (Office files opened from Drive work too).
2. Open the side panel, choose a language, click Translate & Copy.
3. The translated copy appears in the same Drive folder — and opens for you.

FREE TO START
• Quick setup gets you a free Gemini API key in about a minute — no credit card.
• Also works with OpenAI, Claude, or any OpenAI-compatible endpoint.
• A basic free mode works without any key.

YOUR WORDS, YOUR RULES
• Names: for people, brands and places choose translate, keep the original, or both — e.g. 蘋果公司（Apple Inc.）. The AI recognises names by itself.
• Specific terms: fixed translations for your own words, for all files or a single file.
• Tone: keep the original's tone, or go formal, neutral or casual. Add custom instructions in any language.
• Length: as in the original, or concise to fit the layout — your choice, off by default.

BUILT FOR REAL DOCUMENTS
• Formatting follows the words: a coloured or bold phrase inside a sentence moves with its translation instead of being left behind.
• Longer translations still fit: slide fonts shrink to fit, sheet columns widen or wrap — and an optional "Concise" mode keeps translations close to the original length.
• Sheets dropdowns are translated together with the cells, so values stay valid.
• Several target languages in one run — one copy per language.
• Translate only some slides, or only the current sheet tab.
• Keeps working when you close the side panel; notifies you when the copy is ready.

10 LANGUAGES
English, 繁體中文, 简体中文, 日本語, 한국어, Español, Français, Deutsch, Tiếng Việt, ไทย — for translation and for the extension's own interface, which opens in your browser's language automatically.

PRIVACY
No servers, no tracking. Your API key and settings stay in your browser; the text is sent only to the translation service you choose.
```

**Screenshots** (max 5, upload in this order): `screenshot-overview.png` (all features at a glance), `photo-slide.png`, `photo-doc.png`, `photo-sheets.png`, `photo-form.png` — the photos are real Google Slides/Docs/Sheets/Forms with the current side panel (rebuild with `python3 store-assets/retouch.py`; the rest with `python3 store-assets/build.py`).
**Small promo tile**: `small-tile-440x280.png` · **Marquee**: `marquee-1400x560.png`

## Privacy practices tab

**Single purpose**

> Translates the content of Google Slides, Docs, Sheets and Forms files into another language by creating a translated copy in the user's Google Drive.

**Permission justifications**

| Permission | Justification |
|---|---|
| `identity` | Signs the user in with Google (OAuth) so the extension can copy the file being translated and write the translation into the copy via the Drive, Slides, Docs, Sheets and Forms APIs. |
| `storage` | Stores the user's settings (API key, engine, translation preferences), translation history, a local translation cache and job progress in chrome.storage.local. |
| `sidePanel` | The extension's whole interface is a side panel shown next to the open Google file. |
| `activeTab` | Detects which Google Slides/Docs/Sheets/Forms file is open in the current tab, so the user can translate it. |
| `notifications` | Tells the user that a translation has finished when the side panel is closed. |
| `scripting` | When the user chooses "only translate the current sheet", reads the name of the active sheet tab on the Google Sheets page (needed for .xlsx files, whose sheet IDs change when copied). Nothing else is read. |
| Host permissions (docs.google.com, googleapis.com, the Gemini/OpenAI/Anthropic APIs) | Read and write the user's Google files through Google's APIs and send text to the translation service the user selected. |
| Optional host permissions | Requested only when the user adds a custom OpenAI-compatible endpoint, and only for that address. |
| Remote code | No — all code is in the package. |

**Data usage**: website content (the text of the file being translated) is sent to the translation service the user selects; it is not sold, not used for anything else, and not transferred to the developer.

**Privacy policy URL**: the hosted copy of `privacy-policy.html` (updated October 2026 — publish the new version before submitting).

## What's new (for the release notes / description footer)

> v1.7.0 — Coloured or bold words inside a sentence move with the translation · optional "Concise" translation length · slide text shrinks further to fit, with a reminder to take a quick look · Sheets dropdowns translated with the cells · an unusual AI reply no longer stops the job · interface and target language follow your browser (Traditional/Simplified Chinese by region).
>
> v1.6.0 — Quick setup with a free Gemini key · translation preferences (names, terms, tone) · several languages in one run · translate selected slides or the current sheet · progress with time left and a completion notification · longer text fits better · copies named after the real file · clearer messages in 10 languages.
