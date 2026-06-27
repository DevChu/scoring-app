# 2026 MIP挑戰營計分系統

純前端 Google Sheets 計分系統，適合部署到 GitHub Pages。老師用手機掃 QR Code 或連結進入後，以 Google 登入；系統會檢查登入帳號是否可編輯指定試算表，通過才可送出加分。

## 使用步驟

1. 將 `outputs/019f06c5-800b-7bc0-9e36-4c32c86bf966/2026_MIP_scoring_template.xlsx` 上傳到 Google Drive，並用 Google 試算表開啟。
2. 將老師帳號加入該 Google 試算表的編輯權限。
3. 在 Google Cloud 建立 OAuth Client ID，授權來源加入你的 GitHub Pages 網域。
4. 修改 `config.js`，填入 `googleClientId` 與 `spreadsheetId`。
5. 將此資料夾發布到 GitHub Pages，再把網址做成 QR Code。

## 工作表

- `Settings`：營隊名稱、量表設定與說明。
- `Teams`：五組組別資料；可在網頁「組別」頁籤更新組名與職業公會。
- `Missions`：七個任務節點，可自行修改。
- `Scores`：老師每次送出的計分紀錄。
- `Leaderboard`：依 `Scores` 自動彙總排名，供投影頁讀取。

## Google API

OAuth scopes:

- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/drive.metadata.readonly`

前端會用 Drive API 讀取 `capabilities.canEdit`，再用 Sheets API append 到 `Scores`。
