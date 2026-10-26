# Workspace Translator Pro

Chrome 擴充功能（Manifest V3）。把 Google Slides / Docs / Sheets / Forms **複製一份**再翻譯，
原檔完全不動，並盡量保留版面、格式、超連結。

支援翻譯引擎：Gemini、OpenAI、Claude、任何 OpenAI 相容端點、以及免金鑰的 Google Translate 網頁介面。

- **目前版本**：1.6.0（唯一來源：[manifest.json](manifest.json) 的 `version` 欄位）
- **介面語言**：10 種可切換語系（en / zh-TW / zh-CN / ja / ko / es / fr / de / vi / th），使用者在擴充功能內即可切換
- **技術棧**：純原生 JavaScript（ES Module）+ HTML + CSS。**沒有** build step、沒有 npm、沒有框架、沒有測試框架。
- **執行方式**：Chrome → `chrome://extensions` → 開啟「開發人員模式」→「載入未封裝項目」→ 選這個資料夾。改完程式碼按重新載入即可，不需編譯。

---

## 接手者請按這個順序讀

| 順序 | 文件 | 為什麼要讀 |
|---|---|---|
| 1 | 本檔（README） | 5 分鐘知道這是什麼、怎麼跑起來 |
| 2 | [docs/01-架構設計.md](docs/01-架構設計.md) | 四個檔案各自負責什麼、一次翻譯的完整資料流 |
| 3 | **[docs/02-影響範圍地圖.md](docs/02-影響範圍地圖.md)** | ⚠️ **改任何東西前必讀。** 你問的「全域 / 非全域」答案在這裡 |
| 4 | [docs/03-修改指南.md](docs/03-修改指南.md) | 常見需求的標準改法（新增語言／引擎／檔案類型）+ 手動測試清單 |
| 5 | [docs/04-版本與發布.md](docs/04-版本與發布.md) | 版號規則、打包上架、簽章金鑰（**千萬別弄丟**） |
| 6 | [docs/05-已知問題與技術債.md](docs/05-已知問題與技術債.md) | 我逐行讀完後找到的實際問題清單 |
| 7 | [docs/06-多語系介面設計.md](docs/06-多語系介面設計.md) | 可切換介面語系（10 種）的設計 + **新增語系的擴充規範**。✅ 側邊欄已上線（v1.4.0）；說明頁／商店頁仍待做 |

---

## 檔案總表

| 檔案 | 行數 | 角色 | 執行環境 |
|---|---|---|---|
| [manifest.json](manifest.json) | 43 | 擴充功能宣告：權限、版號、進入點、Extension ID 鎖定 | — |
| [background.js](background.js) | 1775 | **Service Worker**。翻譯流程總指揮、Google API 呼叫、佇列管理 | 背景（會被 Chrome 隨時殺掉） |
| [translate.js](translate.js) | 648 | **翻譯引擎轉接層**。被 background.js `import`，處理批次、快取、限流、重試 | 同 background.js |
| [popup.js](popup.js) | 1267 | **側邊欄 UI**。偵測目前分頁檔案、設定畫面、進度條、歷史紀錄 | Side Panel 頁面 |
| [popup.html](popup.html) / [popup.css](popup.css) | 274 / 1326 | 側邊欄結構與樣式（深色玻璃擬態） | Side Panel 頁面 |
| `i18n/languages.js` | 102 | **語言註冊表**——10 種語言的唯一資料來源。新增語言只改這裡 | 被各處 import |
| `i18n/i18n.js` | 169 | 執行期 i18n：`loadLocale` / `t` / `applyI18n` / `tStatus` | Side Panel 頁面 |
| `i18n/locales/*.json` | 140 鍵 ×10 | 語系字典（10 語系：en / zh-TW / zh-CN / ja / ko / es / fr / de / vi / th） | 執行期 fetch |
| `i18n/locales/*.style.md` | — | 每語系的翻譯風格指南（語域、精簡策略）。**開發用，不上架** | — |
| `i18n/validate.mjs` | — | 語系驗證（鍵完整性 + 佔位符 + 版本一致）`node i18n/validate.mjs` **發布前必跑** | Node，不上架 |
| `i18n/coverage.mjs` | — | 介面翻譯覆蓋率門檻（`--min 100`），CI 可用 exit code 把關 | Node，不上架 |
| `i18n/build-qa-locale.mjs` | — | 偽本地化語系產生器（抓漏抽字串與版面溢出）→ `locales/qa.json` | Node，不上架 |
| [onboarding.js](onboarding.js) | 107 | 說明／教學頁的分頁切換與「複製 Redirect URI」 | 獨立分頁 |
| [onboarding.html](onboarding.html) / [onboarding.css](onboarding.css) | 234 / 659 | 三步驟新手教學頁 | 獨立分頁 |
| [privacy-policy.html](privacy-policy.html) | 167 | 靜態隱私權政策（Chrome Web Store 上架必要） | 獨立分頁 |
| `icons/` | — | 16 / 48 / 128 px 圖示 | — |
| `上架宣傳圖片/` | — | Chrome Web Store 商店頁宣傳圖 | — |
| `key.pem` | — | ⚠️ **擴充功能簽章私鑰**。已被 .gitignore 排除，**遺失就無法更新已上架版本** | — |
| `response_gemini_2_5.json` | 31 | 開發時手動抓的 Gemini 回應範例，程式**沒有**引用，可視為文件 | — |

---

## 最重要的三個觀念（新手最容易誤解的地方）

### 1. 這個擴充功能不會碰網頁畫面

它**沒有任何 content script**。它從不讀寫 Google Docs 頁面的 DOM。
它只做兩件事：

1. 透過 `chrome.tabs` 讀取「目前分頁的網址和標題」，用正規表示式解析出檔案 ID。
2. 之後全部走 **Google 官方 REST API**（Drive / Slides / Docs / Sheets / Forms）。

**推論**：Google 改版前端畫面，這個擴充功能不會壞；Google 改 API，才會壞。

### 2. 永遠是「先複製，再翻譯複本」

`runTranslationWorkflow()` 第一件事就是呼叫 Drive API 複製檔案，
命名為 `[Translated - 繁體中文] 原檔名`，並放進**原檔的同一個資料夾**。
之後所有寫入動作都只針對複本。**使用者的原始檔案絕對不會被修改** ——
這是產品的核心安全承諾，任何修改都不能破壞它。

### 3. Service Worker 隨時會死

Manifest V3 的背景程式沒有常駐。Chrome 閒置約 30 秒就可能終止它。
所以：

- 所有狀態都寫在 `chrome.storage.local`，**不能只放在記憶體變數**。
- 側邊欄每 10 秒送一次 `ping`（[popup.js:486](popup.js:486)）把它撐著。
- 背景重啟時 `cleanUpStaleStates()`（[background.js:14](background.js:14)）會把所有未完成的任務標記為「已中斷」。
- **所以：關掉側邊欄，長時間的翻譯有可能被中斷。**

---

## 30 秒跑起來

```bash
open -a "Google Chrome" chrome://extensions
```

1. 右上角開啟「開發人員模式」
2. 點「載入未封裝項目」，選這個資料夾
3. 打開任一 Google Slides / Docs / Sheets / Forms
4. 點工具列的擴充功能圖示 → 側邊欄打開
5. 齒輪 ⚙️ → 選引擎 → 貼 API Key → **必須按「Test Connection」**（狀態不是 `active` 就不給翻譯，見 [popup.js:831](popup.js:831)）→ Save
6. 選目標語言 → Start Translation

除錯：側邊欄下方的 Log Console 會即時顯示背景日誌；
或在 `chrome://extensions` 點該擴充功能的「Service Worker」連結開背景 DevTools。
