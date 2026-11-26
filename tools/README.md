# 改動後必跑的全站檢查

**每次改任何東西、結束前都必須跑這支腳本，並把結果附上。**

## 一鍵執行

```bash
python3 tools/check_site.py
```

檢查正式站 `https://dodafga.github.io`。

### 其他用法

```bash
# 改完先在本機預覽時檢查（先 python3 -m http.server 8099）
python3 tools/check_site.py --base http://localhost:8099

# 輸出 JSON（給程式或其他工具用）
python3 tools/check_site.py --json
```

## 環境需求

```bash
pip install playwright
python3 -m playwright install webkit
```

## 檢查項目

| # | 項目 | 說明 |
|---|---|---|
| 1 | **頁面開啟** | 8 頁全部實際開一次：`/` `/form/` `/photo/` `/log/` `/progress/` `/drive/` `/settings/` `/build/` |
| 2 | **HTTP 狀態** | 每頁必須 200 |
| 3 | **完整渲染** | 可見文字 > 40 字（低於此視為白屏） |
| 4 | **JS 錯誤** | `pageerror` 與 `console.error` 必須為 0 |
| 5 | **殘留 camopen** | `html.camopen` 存在但相機沒開 → 判定為白屏失敗 |
| 6 | **水平溢出** | `scrollWidth - clientWidth` 必須 ≤ 2px |
| 7 | **JS 語法** | `assets/*.js` 全部通過 `node --check` |
| 8 | **asset 版本號** | 改過的 asset 必須帶 `?v=`（避免 iPhone 快取舊檔） |
| 9 | **asset 可取得** | 關鍵 asset 必須 HTTP 200 且 > 200 bytes |

## 輸出格式

```
====================================================================
全站檢查結果  base=https://dodafga.github.io
====================================================================
PASS [http    ] /drive/                HTTP 200
PASS [render  ] /drive/                可見文字 1995 字
...
--------------------------------------------------------------------
總計 96 項，通過 96，失敗 0
====================================================================
```

失敗時會在最後印出失敗清單，明確指出**哪一頁 / 哪個檔案 / 什麼錯誤**：

```
失敗清單：
  ✗ js / /drive/ → pageerror: Cannot read properties of undefined
  ✗ syntax / assets/foo.js → SyntaxError: Unexpected token
```

## 退出碼

- `0` = 全部通過
- `1` = 有失敗（CI 或腳本鏈可用此判斷）

## 為什麼要檢查「殘留 camopen」

`html.camopen` 是站內相機全螢幕模式的狀態。相機 CSS 有：

```css
html.camopen header, html.camopen main { display: none !important }
```

若使用者在相機模式中途切換 App、或把網站「加到主畫面」後再開啟，`camopen` 可能殘留而相機並未開啟 → **整頁空白（白屏）**。

已做的三層防護：
1. `cam.js` 的 `resetCamState()`：`stop()` / `visibilitychange` / `pageshow` 一律清除
2. `cam.js` 載入時 `healStale()` 自癒
3. `drive/`、`progress/` 的 `<body>` 開頭有內嵌保險，第一次繪製前就清掉

腳本的第 5 項檢查就是用來確認這個問題沒有復發。

## 相關注意

- **asset 版本號**：改過 JS 後，記得更新引用它的頁面裡的 `?v=` 值，否則 iPhone 會繼續用舊快取。檢查腳本會抓出漏掉的。
- **不要只看 HTTP 200 就發布**：曾經發生過檔案被截斷成 17 bytes 仍回 200 的情況。腳本第 9 項會檢查檔案大小。
