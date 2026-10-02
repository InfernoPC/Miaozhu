# Miaozhu 喵助

[繁體中文](README.zh-TW.md)

A cross-platform desktop AI assistant that lives on your screen as a line-art cat peeking over a table edge. Click it to ask something, drop files on it, and watch it slap the desk while it works.

It connects to any OpenAI-compatible API, can use tools on your computer (files, shell, web, screenshots), and asks before doing anything that changes things.

> Status: early development (milestones M1–M4 of [DESIGN.md](DESIGN.md) are done). The UI is in Traditional Chinese. macOS is tested; Windows is not yet.

## Features

**Chat with the cat**
- Click the cat to type a question; the reply appears in a speech balloon above it.
- Double-click for a full chat window with Markdown rendering.
- Drag files or folders onto the cat to attach them, with quick actions like "summarize" or "translate".
- Show it your screen: the camera button in the chat window (or "截圖問喵助" on the cat's right-click menu) takes a screenshot of a region, a window (macOS) or the whole screen and attaches it. Pasting an image (⌘V / Ctrl+V) works too.
- Give it your own persona (name, personality, speaking style) in Settings → 角色. Language, honesty, permission and safety rules stay fixed underneath and can't be overridden by the persona.
- Conversations are kept in a list: start a new one, reopen, rename or delete old ones.
- Reminders: "remind me at 3 pm" or "every weekday at 9" — the cat jumps up on time, with snooze. Do-not-disturb and quiet hours hold reminders until they end.
- Swap the character: two built-in cats, or install a skin pack (Lottie animations or one image per state; see [`skins/`](skins)).

**Sensitive folders stay on your machine**
- Mark folders (payroll, contracts…) as sensitive and pick a local model (Ollama, LM Studio). As soon as the cat reads from one, that conversation switches to the local model before anything is sent, stays local afterwards, and asks before any network call.

**Works with the model you have**
- Any OpenAI-compatible endpoint: OpenAI, Azure OpenAI, OpenRouter, LiteLLM / One API gateways, Ollama, LM Studio, vLLM.
- Claude with an Anthropic Console API key (default Claude Opus 5.5, adaptive thinking, prompt caching, server-side refusal fallbacks).
- OpenRouter sign-in in the browser (OAuth PKCE): no copying API keys.
- Up to three fallback models, tried in order when the main one is rate-limited or down. Handy for free-tier models.
- API keys are encrypted with the OS keychain (macOS Keychain / Windows DPAPI) and never reach the UI process.

**Tools**

| Tool | What it does | Asks first? |
|---|---|---|
| List, read, search files | Text, CSV, code, PDF (text extraction), images | Only outside your allowed folders |
| Write, move, create folders | | Every time |
| Delete | Always moves to the Trash / Recycle Bin | Every time |
| Run commands | zsh on macOS, PowerShell on Windows | Every time |
| Web search | Google (via Serper), Tavily, Brave, or self-hosted SearXNG | No |
| Read web pages | Intranet and local addresses ask first | Intranet only |
| Find places on Google Maps | Ratings, review counts, addresses and map links (needs the Serper key) | No |
| Plan a route | Opens Google Maps directions in your browser; no key needed | No |
| Set, list and cancel reminders | One-off or repeating | No |
| Screenshot | macOS asks for Screen Recording permission once | Every time |

**Plugins** (Settings → 外掛)
- Compatible with Claude Code plugins: `SKILL.md` skills, MCP servers (`.mcp.json`, stdio or HTTP), plus tools declared in YAML (HTTP or CLI) with no code.
- Browse multiple marketplaces in the Claude Code `marketplace.json` format. Anthropic's official marketplace is added by default; add your team's with `owner/repo`, a Git URL, a link to `marketplace.json` or a local folder. Installed plugins show when an update is available. Sort by name or by popularity when the marketplace publishes install counts in entry `metadata`.
- Add MCP servers without a plugin: paste a config from Claude Desktop, Claude Code, VS Code or a server's README, or fill in a form. Tokens and API keys in it move to the keychain.
- Or install directly from a folder, a zip file or a Git URL. Either way, before anything runs you see every skill, the exact MCP command lines and each tool's risk level.
- Plugin parts that only work inside Claude Code (slash commands, subagents, hooks) are flagged in the review.
- Skills are listed to the model by name and description only and loaded when needed. MCP tool calls ask first.
- Secrets for declared tools are stored encrypted and scrubbed from output. CLI tools run without a shell, so arguments can't inject commands.
- See [`plugins/examples`](plugins/examples) for a working example and the YAML reference.

**Safety**
- Credential and browser-data locations (`~/.ssh`, `~/.aws`, Keychain, browser profiles…) are always blocked, even if you approve. Paths are symlink-resolved before checking, so links can't be used to get around this.
- "Allow for this conversation" grants last until you clear the chat.
- Every tool call is written to a local audit log.
- The conversation is saved locally and restored after a restart (images are not saved). Permission grants are not restored.
- File and web content is treated as data, not instructions, in the system prompt.

## Install

**macOS** (Apple Silicon or Intel), in Terminal:

```bash
curl -fsSL https://github.com/InfernoPC/Miaozhu/releases/latest/download/install.sh | bash
```

**Windows**, in PowerShell (no admin rights needed):

```powershell
irm https://github.com/InfernoPC/Miaozhu/releases/latest/download/install.ps1 | iex
```

The same line updates or reinstalls; settings and conversations are kept. The app also checks for updates every 6 hours and offers a one-click update (Settings → 關於).

The builds are not signed with a paid certificate. The scripts download the release, check it against `SHA256SUMS`, and install per user: `~/Applications/Miaozhu.app` on macOS (ad-hoc signed), `%LOCALAPPDATA%\Programs\desktop-agent` on Windows. Downloading this way doesn't trigger the Gatekeeper / SmartScreen warnings that a browser download would. Read the scripts first if you like: [install.sh](scripts/install.sh), [install.ps1](scripts/install.ps1).

## Getting started (development)

Requires Node.js 20 or later.

```bash
npm install
npm run dev
```

If `npm run dev` fails with `Error: Electron uninstall`, the Electron binary didn't download:

```bash
node node_modules/electron/install.js
```

For "near me" questions, add your usual places (office, home) in Settings → 網路搜尋 → 常用地點. The first one is used as "near me".

On first launch the settings window opens. Pick a connection type, fill in the base URL, API key and model (or use the OpenRouter sign-in), then test and save.

### Screenshots on macOS during development

macOS grants Screen Recording to the app that launched the process. Under `npm run dev` that's your terminal, which would then need a restart. Instead run:

```bash
npm run start:mac
```

This builds and launches Electron on its own, so you only need to allow "Electron" in System Settings → Privacy & Security → Screen & System Audio Recording.

## Using the cat

| Action | Result |
|---|---|
| Click | Open the input box (Enter to send, Esc to close) |
| Double-click | Open the chat window |
| Drag | Move the cat |
| Drop files or folders on it | Attach them, with quick-action buttons |
| Right-click | Menu: chat, switch model, switch skin, do-not-disturb, new conversation, update (when available), settings, quit |

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development mode with hot reload |
| `npm run start:mac` | Build and launch as a standalone app (macOS) |
| `npm test` | Run the test suite (Vitest; no Electron or network needed) |
| `npm run typecheck` | Type-check main, renderer and tests |
| `npm run build` | Build to `out/` |
| `npm run dist:mac` / `npm run dist:win` | Build installers (unsigned) |

### Releasing

```bash
make release VERSION=0.3.0
```

This bumps `package.json`, tags `v0.3.0` and pushes. GitHub Actions ([release.yml](.github/workflows/release.yml)) runs the tests, builds the macOS zips and the Windows installer, and publishes them with the install scripts, `latest.json` (read by the update check) and `SHA256SUMS`. Run `make help` for the other targets.

## Project layout

```
src/
├── main/                 # Electron main process: model calls, keys, windows
│   ├── agent/            # Conversation and tool-calling loop, context management
│   ├── providers/        # OpenAI-compatible provider, fallback models
│   ├── tools/            # Built-in tools: files, shell, web, screenshot
│   ├── permissions/      # Permission checks, blocked paths, audit log
│   ├── plugins/          # Plugin install/review, skills, MCP client, YAML tools
│   ├── auth/             # OpenRouter OAuth sign-in
│   ├── settings/         # Connection settings and encrypted keys
│   ├── windows/          # Pet, chat and settings windows
│   └── ipc.ts            # Main ↔ renderer messages
├── preload/              # Bridge: the UI can only reach main through window.api
├── shared/types.ts       # Shared types and the IPC contract
tests/                    # Vitest: permissions, tools, agent loop, providers, saved chats
└── renderer/src/
    ├── pet/              # Desktop characters: desk-slapping cat, orange cat
    ├── chat/             # Chat window
    └── settings/         # Settings window
```

## Roadmap

See [DESIGN.md](DESIGN.md) (Traditional Chinese). Next up:

- **M5**: one-line install and in-app update (done), audit log viewer, a company plugin catalog, Windows testing

## Credits

The desk-slapping cat is original artwork drawn in SVG for this project, inspired by the "Bongo Cat" meme. It does not use the original Bongo Cat artwork.
