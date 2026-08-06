# 繁體中文（zh-TW）翻譯風格指南

> 每個語系都應該有一份 `<code>.style.md`。字典能裝下任何譯法，但**無法保證 139 個字串
> 跨多位譯者維持一致的語域** —— 那要靠這份文件。新增或修改 `zh-TW.json` 前請先讀這裡。

---

## 1. 語域與人稱

| 規則 | ✅ 這樣寫 | ❌ 不要這樣 |
|---|---|---|
| **不用「您」，用「你」或直接省略** | `請檢查網路連線` | `請檢查您的網路連線` |
| 台灣用語，不用大陸用語 | 程式、檔案、資料夾、預設、模型 | 程序、文件（指 file）、文件夾、默認 |
| 語氣平實，不過度客套 | `請先輸入 API 金鑰。` | `煩請您先行輸入 API 金鑰，謝謝。` |
| 錯誤訊息不責怪使用者 | `金鑰無效或尚未啟用` | `你輸入了錯誤的金鑰` |

> 「您」在台灣軟體介面已經偏舊式且顯得距離感重。Google、Apple 的繁中介面
> 多數也已改用省略主詞或「你」。

## 2. 標點

- **中文句子用全形標點**：`。，、；：？！（）「」`
- **中英混排時，數字與英文前後不加空格**（由字型處理），但**專有名詞與中文之間留一個半形空格**
  - ✅ `正在使用 GEMINI 翻譯文字…`
  - ✅ `Gemini API 今日的免費額度已用完（429）。`
  - ❌ `正在使用GEMINI翻譯文字…`
- **省略號用中文全形 `…`（單一字元），不用 `...`**
  - ✅ `正在連線…`
  - ❌ `正在連線...`
- **引號用「」，不用 ""**
  - ✅ `請點擊「建立翻譯複本」`
- 括號內若全是英文／數字，仍用全形括號以配合中文句子：`（429）`、`（RPD）`

## 3. 不翻譯的專有名詞

以下**一律保留原文**，不音譯也不意譯：

```
Google · Google Drive · Google Cloud Console · Google AI Studio
Gemini · OpenAI · Claude · API · LLM · RPD · RPM
Excel · Word · PowerPoint
```

Google 產品名的中文官方譯名**要用**：`Google 簡報`、`Google 文件`、`Google 試算表`、`Google 表單`。

## 4. 詞彙對照表（統一用字）

| 英文 | 統一譯法 | 備註 |
|---|---|---|
| API key | **API 金鑰** | 不用「密鑰」「秘鑰」 |
| model | **模型** | |
| endpoint | **端點** | `Base Endpoint URL` → `API 端點網址` |
| provider | **服務供應商** | 不用「提供商」 |
| quota | **額度** | 不用「配額」 |
| rate limit | **頻率上限** | |
| copy（名詞） | **複本** | 不用「副本」 |
| copy（動詞） | **複製** | |
| translation（成品） | **譯文** / **譯本** | 譯文＝文字；譯本＝整份檔案 |
| extract | **擷取** | 不用「提取」 |
| apply | **套用** | |
| verify / test | **驗證** / **測試** | 狀態用「驗證」，動作用「測試連線」 |
| valid / invalid | **有效** / **無效** | 狀態燈用「生效中」／「已失效」 |
| settings | **設定** | 不用「設置」 |
| tab（瀏覽器） | **分頁** | 不用「標籤頁」 |
| sheet tab（試算表） | **分頁** | |
| log | **日誌** | |
| retry | **重試** | |
| timeout | **逾時** | 不用「超時」 |

## 5. 按鈕與短標籤

- **動詞開頭，不超過 6 個字**：`建立翻譯複本`、`停止翻譯`、`測試連線`、`儲存設定`
- **不加句號**
- 進行中狀態用「正在…」：`正在停止…`、`測試中…`

## 6. ⚠️ 交叉引用必須同步

有些訊息會**提到按鈕名稱**。改按鈕文字時，這些訊息必須一起改，否則會叫使用者去點一個不存在的按鈕：

| 按鈕鍵 | 目前文字 | 被哪些訊息引用 |
|---|---|---|
| `main.btnTranslate` | 建立翻譯複本 | `error.interrupted`、`error.stopped` |
| `settings.testConnection` | 測試連線 | `modal.apiKeyRequired.msg`、`modal.apiKeyUnverified.msg`、`modal.apiKeyInvalid.msg` |
| `settings.btnSave` | 儲存設定 | `settings.uiLanguage.hint`（「不需按儲存」） |

## 7. 長度限制

側邊欄最窄 320px。判斷標準**不是字數，而是顯示寬度不得超過英文原文** ——
版面是照英文排的，而中日韓文字約佔兩個半形字元的寬度，所以「字數少」不等於「比較窄」。

```
「透過 LLM API 翻譯文字」= 15 個字元，但顯示寬度 21
"Translate text runs via LLM API"  = 31 個字元，顯示寬度 31   → 通過
```

適用於下列短標籤（已由測試自動檢查）：

```
settings.status.*        狀態徽章
main.btnTranslate / btnStop / btnStopping / settings.btnSave / settings.testConnection
steps.*                  四顆步驟燈
history.clear · logs.show · logs.hide
```

進度文字（`progress.*`）可換行，但不宜超過兩行。

中文通常比英文短，所以這條大多自然成立 —— 但**別為了「完整」而把句子寫長**。

## 8. 送審前檢查

```bash
node i18n/validate.mjs                                   # 鍵完整性、佔位符一致性
node i18n/coverage.mjs --exclude onboarding --min 100    # 沒有漏抽的硬編碼字串
```

母語者複核完成後，把 `zh-TW.json` 的 `_meta.reviewedBy` 改成 `native-speaker`。
