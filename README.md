# 查驗表單產生器（Inspection Suite）

工程查驗文件線上填寫工具。純前端（HTML / CSS / JavaScript），**不需要伺服器、不需要資料庫、不需要安裝任何套件**，直接放上 GitHub Pages 即可使用。

內含三個模式，可在同一頁切換：

| 模式 | 說明 | 輸出格式 |
|------|------|----------|
| 📋 **查驗單** | 工程施工中請驗單，版面沿用 F-24-03 範本（A4 直式、標楷體）。可勾選「附件表單」一起合併輸出。 | `.docx` |
| 📷 **查驗相片表** | 工程照片記錄表，每頁 3 張照片，照片尺寸與範本一致（A4 直式）。每一頁都能各自填寫「本頁說明」。 | `.docx` |
| 📊 **查驗紀錄表** | 逐筆新增、累積多筆查驗紀錄，資料自動存在瀏覽器本機。 | `.xlsx` |

---

## 一、專案結構

```
.
├── index.html              # 首頁（三個模式的切換外殼）
├── .nojekyll               # 告訴 GitHub Pages 不要用 Jekyll 處理（重要）
├── README.md               # 本說明文件
├── assets/
│   └── jszip.min.js        # 產生 .docx / .xlsx 用的 ZIP 函式庫（三個模式共用）
├── form/                   # 查驗單模式
│   ├── index.html
│   ├── formbuilder.js      # 依範本 XML 產生 Word
│   └── template.docx       # 版面範本（F-24-03）
├── photo/                  # 查驗相片表模式
│   ├── index.html
│   ├── photobuilder.js
│   └── template.docx       # 版面範本
└── log/                    # 查驗紀錄表模式
    ├── index.html
    ├── logbuilder.js
    └── template.xlsx       # 版面範本（標題列深藍底白字粗體置中）
```

所有資源引用**全部使用相對路徑**（例如 `../assets/jszip.min.js`、`template.docx`），因此放在 GitHub Pages 的任何子路徑下都能正常運作。

---

## 二、部署到 GitHub Pages

### 方法 A：用 GitHub 網頁介面上傳（最簡單，不用裝 Git）

1. **建立 Repository**
   - 登入 [GitHub](https://github.com/) → 右上角 `+` → **New repository**
   - Repository name 例如 `inspection-suite`
   - 選 **Public**（GitHub Pages 免費版需要公開；Private 需付費方案）
   - **不要**勾選 Add a README file（我們已經有了）
   - 按 **Create repository**

2. **上傳檔案**
   - 進入剛建立的 repository → 點 **Add file** → **Upload files**
   - 把本專案**解壓縮後的所有檔案與資料夾**（`index.html`、`assets/`、`form/`、`photo/`、`log/`、`.nojekyll`、`README.md`）一起拖進去
   - ⚠️ **重點**：要上傳的是**資料夾裡面的內容**，不是外面那層資料夾。上傳後 repository 首頁應該直接看到 `index.html`，而不是 `inspection-suite/index.html`。
   - ⚠️ `.nojekyll` 是隱藏檔，用拖曳上傳時請確認它也在清單中（若看不到，可在檔案總管開啟「顯示隱藏檔案」）。
   - 下方 Commit message 隨便填（例如 `Initial commit`）→ 按 **Commit changes**

3. **開啟 GitHub Pages**
   - 進入 repository → 上方 **Settings** 分頁
   - 左側選單找到 **Pages**
   - **Source** 選 `Deploy from a branch`
   - **Branch** 選 `main`，資料夾選 `/ (root)` → 按 **Save**
   - 等 1～2 分鐘，重新整理這個頁面，上方會出現網址：
     ```
     https://<你的帳號>.github.io/inspection-suite/
     ```
   - 點進去就是首頁，三個模式都能用。

### 方法 B：用 Git 指令上傳

```bash
# 在本專案資料夾內
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<你的帳號>/inspection-suite.git
git push -u origin main
```

推上去之後，再照上面「方法 A 的第 3 步」開啟 GitHub Pages 即可。

### 更新檔案

- **網頁介面**：進入 repository → 點要改的檔案 → 右上角鉛筆圖示編輯 → Commit changes。或再按 **Add file → Upload files** 覆蓋舊檔。
- **Git 指令**：改完檔案後 `git add . && git commit -m "update" && git push`。
- 更新後 GitHub Pages 約 1～2 分鐘生效（瀏覽器若看到舊版，按 `Ctrl + F5` 強制重新整理）。

---

## 三、使用方式

### 切換模式
開啟首頁後，右上角有三個按鈕：**查驗單 / 查驗相片表 / 查驗紀錄表**，點擊即可切換。網址會帶上 `#form`、`#photo`、`#log`，可直接分享特定模式的連結。

### 📋 查驗單
1. 填寫工程名稱、單元位置、查驗日期等欄位。
2. 下方逐筆新增「查驗項目」（項目名稱、單位、數量、說明等）。
3. 若要附上附件表單：勾選 **加入附件表單**，展開後填寫（契約項次、項目及說明、單位、查驗數量、監造覆核），可新增／刪除列。
4. 按 **下載 Word**，附件表單會另起一頁接在查驗單後面，成為同一份 `.docx`。

### 📷 查驗相片表
1. 設定工程名稱、表頭標題、起始編號。
2. 上傳照片（每頁 3 張），可為每張照片填寫說明。
3. 用 **← 上一頁 / 下一頁 →** 切換頁次，**每一頁都能各自填寫「本頁說明」**，輸入即時反映在預覽。
4. 按 **下載 Word** 輸出 `.docx`。

### 📊 查驗紀錄表
1. 填寫 **查驗日期**（日期選擇器，格式 `yyyy/mm/dd`，可手動輸入）、**查驗人員**（下拉選單）、**監造人員**（下拉選單）、**查驗位置**。
2. 按 **新增** 加入下方表格，會自動顯示序號。
3. 每列可**編輯**、可**刪除**。
4. 資料自動存在瀏覽器 **localStorage**，重新整理或下次開啟網頁紀錄還在。
5. 按 **下載 Excel** 輸出 `.xlsx`（標題列深藍底白字粗體置中、欄寬、框線、日期格式皆與範本一致）。
6. 按 **清除全部** 可清空所有紀錄。

> **固定選項**
> - 查驗人員：乘恩、順昔、火木、佩璇
> - 監造人員：振源、旭程、慧欣

---

## 四、常見問題

**Q：下載的檔案打不開或格式跑掉？**
A：請用 Microsoft Word / Excel 開啟。`.docx` / `.xlsx` 是標準 Office 格式，WPS、LibreOffice 亦可。

**Q：換一台電腦，查驗紀錄表的資料不見了？**
A：紀錄存在**該瀏覽器的本機儲存空間**（localStorage），不會跨裝置同步。換裝置前請先按「下載 Excel」備份。清除瀏覽器資料也會一併清掉紀錄。

**Q：GitHub Pages 顯示 404？**
A：確認 (1) repository 首頁直接看得到 `index.html`（不是被包在子資料夾裡）；(2) Settings → Pages 的 Branch 設為 `main` / `(root)`；(3) 剛設定完請等 1～2 分鐘。

**Q：網頁打開但功能沒反應？**
A：確認 `assets/`、`form/`、`photo/`、`log/` 四個資料夾都有一起上傳，且 `.nojekyll` 存在。

**Q：可以放在自己的網域嗎？**
A：可以。Settings → Pages → Custom domain 填入你的網域，並依 GitHub 指示設定 DNS。

---

## 五、授權

本專案為內部工程文件工具，請依所屬單位規定使用。
