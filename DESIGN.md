# Desktop Agent 設計規格（v0.1 草案）

> 公司內部用的跨平台（macOS / Windows）桌面 AI 助手，以一隻可替換造型的卡通貓咪常駐桌面。

## 1. 需求摘要

| 項目 | 決定 |
|---|---|
| 使用對象 | 公司內部同事 |
| 核心功能 | 聊天問答、操作電腦/檔案、看螢幕/截圖分析、通用工具串接、Plugin 擴充 |
| 介面形式 | 桌面常駐卡通角色（預設：貓咪），可替換造型 |
| 角色呈現 | 先做 2D 動畫，架構預留 Live2D / 3D 擴充 |
| 角色互動 | 對話氣泡、主動提醒、拖曳檔案給貓 |
| AI 模型 | 以 **OpenAI 相容 API** 為主（OpenAI / Azure OpenAI / 公司 gateway / Ollama / LM Studio 皆可）；Claude API 為選用 |
| Plugin | 相容 Claude 生態：MCP servers + Skills（`SKILL.md`） |
| 工具串接 | 先做通用框架（Tool calling / MCP / CLI / HTTP API），首發內建 Web Search |
| 權限 | 分級確認 |
| 帳號 | MVP 每人自填 API Key，存系統鑰匙圈；架構預留公司代理/SSO |

## 2. 技術選型

**Electron + TypeScript + React + Vite（electron-vite）**

選擇理由：
- 透明、無邊框、置頂、滑鼠穿透的角色視窗，在 Electron 上 mac/win 都有成熟做法
- `openai`、`@anthropic-ai/sdk`、`@modelcontextprotocol/sdk` 官方 SDK 都是 TypeScript，Plugin 生態直接接得上
- 截圖（`desktopCapturer`）、系統匣、全域快捷鍵、自動更新（`electron-updater`）都內建或有現成套件
- 缺點是安裝包約 100MB+，對內部工具可以接受

| 用途 | 套件 |
|---|---|
| LLM（主要） | `openai`（設定 `baseURL`，同時用於雲端與本機模型） |
| LLM（選用） | `@anthropic-ai/sdk` |
| MCP | `@modelcontextprotocol/sdk`（client 端） |
| 角色動畫 | `lottie-web`（主）/ Sprite sheet（備） |
| 金鑰儲存 | Electron `safeStorage`（背後是 Keychain / DPAPI） |
| 本地資料 | JSON 檔（寫入時先寫暫存檔再改名，避免寫到一半損壞），存設定與目前對話；資料量變大（多段對話、搜尋）時再換 SQLite |
| 打包 | `electron-builder`（.dmg / .exe NSIS），mac 需簽章＋公證 |

## 3. 整體架構

```
┌──────────────────────────── Renderer（UI）────────────────────────────┐
│  PetWindow（透明置頂）   ChatWindow（完整對話）   Settings / Plugin 管理  │
│  └ 角色動畫 + 對話氣泡    └ 串流訊息、工具卡片、確認對話框               │
└───────────────▲──────────────────────────────▲───────────────────────┘
                │ IPC（contextBridge，型別化）  │
┌───────────────┴──────────── Main Process ────┴───────────────────────┐
│  Agent Core ── 對話迴圈、上下文管理、串流                              │
│     │                                                                │
│     ├─ LLM Provider 介面 ──┬─ OpenAICompatibleProvider（主要）        │
│     │                      └─ ClaudeProvider（選用）                   │
│     │                                                                │
│     ├─ Tool Registry（統一的工具清單）                                │
│     │    ├─ 內建工具：檔案、Shell、截圖、Web Search、提醒              │
│     │    ├─ MCP 工具（由 MCP Manager 提供）                           │
│     │    ├─ CLI 工具（設定檔宣告的指令）                               │
│     │    └─ HTTP API 工具（設定檔宣告的 REST endpoint）                │
│     │                                                                │
│     ├─ Permission Guard ── 分級確認、白名單、操作紀錄                  │
│     ├─ Skill Loader ── 讀取 SKILL.md，依需求注入上下文                 │
│     ├─ Plugin Manager ── 安裝 / 移除 / 啟用 plugin                    │
│     ├─ Scheduler ── 主動提醒（定時、事件觸發）                         │
│     └─ Secret Store ── API Key（safeStorage）                        │
└──────────────────────────────────────────────────────────────────────┘
```

原則：**所有 AI 呼叫、工具執行、金鑰存取都只在 Main Process**；Renderer 只負責顯示，不能直接碰檔案系統或金鑰。

## 4. 模組設計

### 4.1 角色系統（Pet）

**視窗**：`transparent: true`、`frame: false`、`alwaysOnTop: true`、可拖曳移動；非角色區域滑鼠穿透（`setIgnoreMouseEvents(true, { forward: true })`）。

**狀態機**：

| 狀態 | 觸發 | 動畫 |
|---|---|---|
| `idle` | 預設 | 呼吸、甩尾巴、偶爾打哈欠 |
| `listening` | 使用者開始輸入 / 檔案拖到上方 | 耳朵豎起 |
| `thinking` | 等待模型回應 | 歪頭、轉圈 |
| `talking` | 串流輸出中 | 嘴巴動 + 氣泡 |
| `working` | 執行工具中 | 敲鍵盤 / 翻書 |
| `alert` | 需要使用者確認 / 主動提醒 | 跳起來、揮手 |
| `sleeping` | 閒置超過 N 分鐘 | 睡覺 zzz |
| `error` | 發生錯誤 | 沮喪 |

**造型包（Skin Pack）**：可替換造型的單位，一個資料夾：

```
skins/cat-default/
├── skin.json          # 名稱、作者、渲染器類型、各狀態對應檔案、尺寸、氣泡錨點
├── idle.json          # Lottie 動畫
├── thinking.json
├── ...
└── persona.md         # （選用）角色口吻，例如句尾加「喵」
```

`skin.json` 的 `renderer` 欄位預設為 `"lottie"`，未來新增 `"live2d"`、`"vrm"` 只要實作新的 Renderer，不影響其他模組。

**互動**：
- 點一下貓 → 彈出輸入框；雙擊 → 開完整對話視窗
- 回覆以對話氣泡顯示，超過約 3 行自動摺疊並提供「展開」
- 拖曳檔案到貓身上 → 自動附加檔案並詢問要做什麼（摘要 / 翻譯 / 分析）
- 右鍵選單：切換造型、切換模型、暫停提醒、設定、結束

### 4.2 Agent Core

- 手動 agent loop（`while stop_reason === "tool_use"`），因為中間要插入權限確認、角色狀態切換、UI 工具卡片
- 全程串流：文字即時顯示在氣泡；工具呼叫顯示為可展開的卡片
- 平行工具呼叫：同一回合的多個 `tool_use` 並行執行，結果合在一則訊息回傳
- 上下文：由 Agent Core 自行管理（接近上限時把較早的對話摘要化），不依賴特定廠商功能
- 內部訊息格式：Agent Core 使用自己的中立格式（文字、圖片、工具呼叫、工具結果），由各 Provider 轉成對應 API 格式
- Prompt caching：system prompt 與工具清單固定排序、放在最前面，時間等變動資訊放在最後（OpenAI 與 Claude 都受惠）

### 4.3 LLM Provider

統一介面，Agent Core 不需知道後端是誰：

```ts
interface LLMProvider {
  id: string;                       // 使用者自訂，例如 "company-gateway"、"local-ollama"
  kind: "openai-compatible" | "claude";
  capabilities: { vision: boolean; tools: boolean; serverWebSearch: boolean };
  stream(req: AgentRequest): AsyncIterable<AgentEvent>;
}
```

使用者可以設定**多組連線（Profile）**，每組包含：類型、`baseURL`、API Key、模型名稱、是否為本機。

**OpenAICompatibleProvider（主要）**

使用 Chat Completions API（`/v1/chat/completions`），支援串流、`tools` function calling、圖片輸入。這是目前各家支援最廣的格式，一個實作就能接：

| 服務 | baseURL 範例 |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| Azure OpenAI | `https://<resource>.openai.azure.com/openai/v1` |
| 公司內部 AI gateway（LiteLLM / One API 等） | `https://ai-gateway.internal/v1` |
| OpenRouter（支援 OAuth 自動取得 Key） | `https://openrouter.ai/api/v1` |
| Ollama（本機） | `http://localhost:11434/v1` |
| LM Studio（本機） | `http://localhost:1234/v1` |
| vLLM（自架） | `http://<server>:8000/v1` |

- 模型清單從 `GET /models` 取得；取不到時讓使用者手動輸入模型名稱
- 各模型能力差很多，所以第一次使用時會做一次**能力偵測**（送一個小的 tool call 或圖片請求測試），結果存起來，UI 依此隱藏不支援的功能
- **OpenRouter OAuth（PKCE）**：開啟瀏覽器到 `openrouter.ai/auth`，以一次性的 `http://localhost:<隨機埠>/callback` 接收授權碼，再向 `/api/v1/auth/keys` 換取使用者自己的 API Key，由 Main Process 直接加密儲存，Key 不會經過畫面
- **備用模型（Fallback）**：每組連線可設定最多 3 個備用模型。主模型回傳 429 / 402 / 403 / 404 / 5xx 且尚未輸出任何文字時，App 端立即依序改用下一個；400、401、連線失敗不切換。不依賴 gateway 的伺服器端 fallback，因為實測 OpenRouter 的 `models` 參數無法涵蓋「upstream rate-limited」的情況
- 回覆會記錄實際回答的模型名稱，顯示在對話視窗
- 相容性差異集中在一個 adapter 處理（例如部分服務不支援 `stream_options`、tool call 參數分段回傳的格式不同）

**ClaudeProvider（選用）**

使用 **Claude Console 的 API Key**（`sk-ant-...`）連線，Key 由公司 Console 組織發放。使用官方 `@anthropic-ai/sdk`，可用到 Claude 專屬功能：內建 web search、PDF 直接輸入、adaptive thinking。預設模型 `claude-opus-5`。

> 不支援 claude.ai 訂閱帳號（Pro / Max / Team）的 OAuth 登入。這種登入只限 Anthropic 自家產品使用，第三方程式未經核准不得使用。

**路由規則**：使用者可手動切換 Profile；另可設定「敏感模式」資料夾，從這些路徑讀出的內容強制使用標示為「本機」的 Profile。

### 4.4 工具框架（Tool Registry）

所有工具（內建、MCP、CLI、HTTP）統一註冊成：

```ts
interface ToolDef {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  risk: "read" | "write" | "execute" | "network";  // 用於權限分級
  source: "builtin" | "mcp" | "cli" | "http";
  run(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}
```

**首發內建工具**：

| 工具 | 風險 | 說明 |
|---|---|---|
| `web_search` | network | 在本機執行，呼叫可設定的搜尋 API（Tavily / Brave / SearXNG），適用所有模型；使用 Claude Provider 時可改用 Claude 內建的 web search |
| `web_fetch` | network | 讀取網頁內容 |
| `read_file` / `list_dir` / `search_files` | read | 讀檔、列目錄、搜尋 |
| `write_file` / `move_file` / `delete_file` | write | 寫入、搬移、刪除（刪除一律進垃圾桶） |
| `run_command` | execute | 執行 shell 指令（mac: zsh、win: PowerShell） |
| `screenshot` | read | 截全螢幕或指定視窗，交給模型分析 |
| `set_reminder` | write | 建立主動提醒 |

**宣告式工具（不用寫程式就能加）**：

```yaml
# ~/.desktop-agent/tools/erp-order.yaml
name: erp_get_order
type: http
description: 查詢 ERP 訂單狀態
risk: network
request:
  method: GET
  url: https://erp.internal/api/orders/{order_id}
  headers: { Authorization: "Bearer ${secret:erp_token}" }
input_schema:
  type: object
  properties: { order_id: { type: string } }
  required: [order_id]
```

`type: cli` 的格式相同，改成宣告指令與參數。

### 4.5 Plugin 系統（相容 Claude 生態）

一個 plugin 就是一個資料夾，結構沿用 Claude Code plugin 慣例：

```
my-plugin/
├── .claude-plugin/plugin.json   # 名稱、版本、描述、作者
├── skills/
│   └── company-knowledge/
│       ├── SKILL.md             # frontmatter: name, description；內文為指引
│       └── references/...       # 附屬知識檔
├── .mcp.json                    # 這個 plugin 要啟動的 MCP servers
├── tools/*.yaml                 # （擴充）宣告式 CLI/HTTP 工具
└── skins/*                      # （擴充）附帶的角色造型
```

- **Skills**：啟動時只把每個 skill 的 `name + description` 放進 system prompt；模型判斷需要時呼叫 `load_skill` 工具讀取全文（漸進式載入，省 token）
- **MCP**：支援 stdio 與 Streamable HTTP 兩種 transport；每個 server 的工具以 `mcp__<server>__<tool>` 命名加入 Tool Registry
- **安裝來源**：本機資料夾、Git repo URL、zip 檔；之後可加公司內部 marketplace（一個列出 plugin 的 JSON 索引）
- **安全**：安裝時列出這個 plugin 會新增的工具與權限，使用者確認後才啟用

### 4.6 權限控管（分級確認）

| 等級 | 範例 | 預設行為 |
|---|---|---|
| read | 讀檔、列目錄、截圖 | 在白名單資料夾內自動允許；範圍外需確認 |
| network | 網路搜尋、HTTP 工具 | 自動允許（可在設定中改成需確認） |
| write | 寫檔、搬移、刪除 | 每次確認，顯示 diff / 目標路徑 |
| execute | Shell 指令、未知的 MCP 工具 | 每次確認，顯示完整指令 |

- 確認對話框提供「允許一次 / 本次對話都允許 / 拒絕」
- 永久封鎖清單（如系統目錄、`~/.ssh`、瀏覽器 profile），無論如何都不允許
- 所有工具執行都寫入本地操作紀錄（時間、工具、參數、結果、是否經過確認）
- 截圖前貓咪會切到 `alert` 狀態並提示「我要看一下畫面喔」

### 4.7 主動提醒（Scheduler）

- 來源：使用者請 AI 設定的提醒、plugin 註冊的定時任務（例如每天早上整理待辦）
- 觸發時貓咪切到 `alert` 並冒出氣泡，點擊可展開詳情
- 勿擾模式：全螢幕簡報/會議時自動靜音（mac 偵測專注模式，win 偵測全螢幕應用）

### 4.8 設定與金鑰

- 首次啟動引導：選模型來源（OpenAI / Azure / 公司 gateway / 本機 Ollama / Claude）→ 填 baseURL 與 API Key（本機可自動偵測）→ 測試連線與能力偵測 → 選造型 → 設定白名單資料夾
- API Key 以 `safeStorage` 加密存放，Renderer 無法讀取
- `SecretStore` 介面抽象化，未來改成「向公司代理伺服器以 SSO 取得 token」只需替換實作

## 5. 資料夾結構（規劃）

```
desktop-agent/
├── src/
│   ├── main/                # Electron main process
│   │   ├── agent/           # Agent loop、上下文管理
│   │   ├── providers/       # openai-compatible.ts、claude.ts、訊息格式轉換
│   │   ├── tools/           # 內建工具 + registry + 宣告式工具載入
│   │   ├── mcp/             # MCP client 管理
│   │   ├── plugins/         # plugin 安裝、skill loader
│   │   ├── permissions/     # 權限判斷、操作紀錄
│   │   ├── scheduler/       # 提醒
│   │   ├── windows/         # 角色視窗、對話視窗、設定視窗
│   │   └── ipc/             # 型別化 IPC 定義
│   ├── preload/
│   └── renderer/
│       ├── pet/             # 角色渲染器（lottie 實作 + 介面）
│       ├── chat/            # 對話 UI
│       └── settings/
├── skins/cat-default/       # 內建貓咪造型
├── plugins/examples/        # 範例 plugin（含一個 knowledge skill）
└── DESIGN.md
```

## 6. 開發路線圖

| 階段 | 內容 | 驗收標準 |
|---|---|---|
| ✅ **M1 骨架** | Electron 專案、透明角色視窗（佔位貓咪動畫）、點擊開輸入框、OpenAI 相容 API 串流對話、連線設定（baseURL / Key / 模型） | mac/win 都能看到貓並聊天（雲端或本機 Ollama 皆可） |
| ✅ **M2 工具** | Tool Registry、權限確認、檔案工具、Shell、Web Search、截圖、拖曳檔案 | 能請貓整理資料夾、分析截圖、上網查資料 |
| ✅ **M3 擴充** | MCP client、Skill loader、Plugin 安裝、宣告式 CLI/HTTP 工具 | 能安裝一個含 knowledge skill + MCP server 的 plugin |
| ✅ **M4 生活感** | 完整狀態動畫、造型包切換、主動提醒、勿擾模式、敏感資料夾強制走本機模型、Claude Provider（選用） | 可換造型、敏感資料不出電腦 |
| **M5 發佈** | 簽章公證、安裝包、自動更新、操作紀錄檢視、內部 plugin 索引 | 同事可自行下載安裝並自動更新 |

## 7. 待決定事項

0. 目前手上可用的是哪種 API？（OpenAI 帳號 / Azure OpenAI / 公司 gateway / 只有本機 Ollama）。這會決定 M1 用哪組預設值測試
1. 貓咪正式美術由誰製作？（M1 先用簡易佔位動畫）
2. 本機模式的網路搜尋要用哪個搜尋服務？（SearXNG 可自架，Brave / Tavily 需 API Key）
3. Windows 端是否需要支援 Windows 10，或只支援 Windows 11？
4. 是否有 Apple Developer 帳號與 Windows 程式碼簽章憑證？（影響 M5 發佈）
5. 產品正式名稱與貓咪名字 🐱
