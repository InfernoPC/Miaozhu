# 喵助 Miaozhu（繁體中文說明）

[English](README.md)

跨平台（macOS / Windows）桌面 AI 助手，以一隻常駐桌面的貓咪呈現。完整設計見 [DESIGN.md](DESIGN.md)。

目前進度：**M4**完成。喵助可以聊天、操作檔案、執行指令、上網搜尋、看螢幕截圖，所有操作都經過權限控管。

## 喵助能做什麼

| 功能 | 說明 | 需要確認？ |
|---|---|---|
| 列出、讀取、搜尋檔案 | 支援文字、CSV、程式碼、PDF（擷取文字）、圖片 | 允許清單內的資料夾不用；其他位置會先問 |
| 寫入、移動、建立資料夾 | | 每次確認 |
| 刪除 | 一律移到垃圾桶，可以還原 | 每次確認 |
| 執行指令 | macOS 用 zsh，Windows 用 PowerShell | 每次確認 |
| 網路搜尋 | 需要在「設定 → 網路搜尋」選擇服務：Google（透過 Serper，送 2,500 次）、Tavily、Brave 或自架 SearXNG | 不用 |
| 讀取網頁 | 公司內網網址會先詢問 | 公司內網才需要 |
| 搜尋 Google 地圖 | 評分、評論數、地址與地圖連結（需要 Serper Key） | 不用 |
| 規劃路線 | 在瀏覽器打開 Google 地圖路線，不需要 Key；可在「設定 → 網路搜尋 → 常用地點」設定公司、家 | 不用 |
| 擷取螢幕 | macOS 第一次使用需允許「螢幕錄製」權限 | 每次確認 |

- 可以在「設定 → 角色」自訂喵助的名字、個性與說話方式；語言、誠實、權限與安全規則固定不變，角色設定無法覆蓋
- 外掛（設定 → 外掛）：相容 Claude Code 外掛格式（`SKILL.md` 技能、`.mcp.json` MCP 伺服器），另外支援用 YAML 宣告 HTTP / CLI 工具。可以加入多個 marketplace（預設已有 Anthropic 官方 marketplace，也能加入公司或團隊的），或直接從資料夾、zip、Git 網址安裝；安裝前會列出所有技能、MCP 指令與工具風險讓你確認，有新版本時會標示「有更新」。範例見 `plugins/examples`
- 對話紀錄：可以開新對話、切換、重新命名、刪除
- 提醒：「3 點提醒我開會」「每個工作日 9 點提醒我打卡」；可延後，勿擾與安靜時段期間會先保留
- 敏感資料夾：讀到就改用本機模型，內容不送到雲端，之後連網也會先問
- 換造型：內建兩隻貓，或安裝 Lottie／圖片造型包（見 `skins/`）
- 確認時選「本次對話都允許」，清除對話前同類操作不再詢問
- `~/.ssh`、瀏覽器資料、鑰匙圈等位置**永遠禁止存取**，就算使用者同意也不行
- 每次操作都記錄在本機操作紀錄（設定 → 檔案權限 → 操作紀錄）
- 對話會存在本機，重開 App 後自動恢復（圖片不保存）；「這次對話都允許」的授權不會恢復

## 安裝

**macOS**（Apple 晶片或 Intel 都可以），打開「終端機」貼上：

```bash
curl -fsSL https://github.com/InfernoPC/Miaozhu/releases/latest/download/install.sh | bash
```

**Windows**，打開 PowerShell 貼上（不需要系統管理員權限）：

```powershell
irm https://github.com/InfernoPC/Miaozhu/releases/latest/download/install.ps1 | iex
```

同一行指令也可以用來更新或重新安裝，設定和對話都會保留。喵助每 6 小時會自動檢查新版，有新版時貓咪會提醒，按一下就能更新（也可以在 設定 → 關於 手動檢查）。

安裝檔沒有付費憑證簽章。安裝指令會下載正式版、比對 `SHA256SUMS` 檢查碼，再安裝到使用者自己的資料夾：macOS 是 `~/Applications/Miaozhu.app`，Windows 是 `%LOCALAPPDATA%\Programs\desktop-agent`。用指令下載不會跳出瀏覽器下載時的 Gatekeeper / SmartScreen 警告。想先看看指令做了什麼：[install.sh](scripts/install.sh)、[install.ps1](scripts/install.ps1)。

## 開發環境

需要 Node.js 20 以上。

```bash
npm install
npm run dev
```

如果 `npm run dev` 出現 `Error: Electron uninstall`，代表 Electron 主程式沒有下載成功，執行：

```bash
node node_modules/electron/install.js
```

## 第一次使用

第一次啟動會自動開啟「設定」視窗：

1. 在左側「新增連線」選擇類型（公司 AI Gateway、OpenRouter、Azure OpenAI、OpenAI、Ollama、LM Studio）
   - **OpenRouter** 可以按「用 OpenRouter 帳號登入」，瀏覽器授權後自動取得並儲存 API Key，不用手動複製
2. 填入 **Base URL**、**API Key**、**模型名稱**。可按「取得模型清單」從伺服器讀取可用模型
3. 按「測試連線」確認可用後，再按「儲存」

API Key 以作業系統鑰匙圈加密（macOS Keychain / Windows DPAPI），只存在這台電腦。

## 操作方式

| 動作 | 效果 |
|---|---|
| 點一下貓咪 | 開啟輸入框，Enter 送出、Esc 取消 |
| 雙擊貓咪 | 開啟完整對話視窗 |
| 拖曳貓咪 | 移動位置 |
| 把檔案或資料夾拖到貓咪身上 | 附加檔案，並提供「摘要重點」「翻譯」等快捷按鈕 |
| 右鍵貓咪 | 選單：對話視窗、切換模型連線、切換造型、勿擾模式、新對話、更新（有新版時）、設定、結束 |

## 指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | 開發模式（修改畫面程式碼會即時更新） |
| `npm run start:mac` | macOS：編譯後以獨立 App 啟動（不經過終端機）。需要截圖時用這個，螢幕錄製權限只要允許「Electron」，不必重開終端機 |
| `npm test` | 執行自動測試（不需要 Electron 或網路） |
| `npm run typecheck` | 型別檢查 |
| `npm run build` | 編譯到 `out/` |
| `npm run dist:mac` / `npm run dist:win` | 產生安裝檔（尚未簽章） |

### 發佈新版

```bash
make release VERSION=0.3.0
```

會更新 `package.json` 版本、打上 `v0.3.0` 標籤並推送。GitHub Actions（[release.yml](.github/workflows/release.yml)）接著跑測試、打包 macOS 與 Windows 安裝檔，連同安裝指令、`latest.json`（給更新檢查用）和 `SHA256SUMS` 一起發佈。其他指令可用 `make help` 查看。

## 專案結構

```
src/
├── main/                 # Electron main process（AI 呼叫、金鑰、視窗都在這裡）
│   ├── agent/            # 對話與工具呼叫迴圈、上下文管理
│   ├── providers/        # 模型接口：OpenAI 相容、Claude、備用模型
│   ├── tools/            # 內建工具：檔案、指令、網路、截圖
│   ├── permissions/      # 權限判斷、受保護路徑、操作紀錄
│   ├── auth/             # OpenRouter OAuth 登入
│   ├── settings/         # 連線設定與加密金鑰
│   ├── windows/          # 桌面貓咪、對話、設定視窗
│   └── ipc.ts            # main ↔ 畫面 的通訊
├── preload/              # 安全橋接，畫面只能透過 window.api 呼叫 main
├── shared/types.ts       # 共用型別與 IPC 介面
└── renderer/src/
    ├── pet/              # 桌面角色：拍桌貓（DeskCat）、橘貓（SvgCat），右鍵可切換
    ├── chat/             # 對話視窗
    └── settings/         # 設定視窗
```
