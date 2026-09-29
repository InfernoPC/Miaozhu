# Miaozhu 喵助

[繁體中文](README.zh-TW.md)

A cross-platform desktop AI assistant that lives on your screen as a line-art cat peeking over a table edge. Click it to ask something, drop files on it, and watch it slap the desk while it works.

It connects to any OpenAI-compatible API, can use tools on your computer (files, shell, web, screenshots), and asks before doing anything that changes things.

> Status: early development (milestones M1 and M2 of [DESIGN.md](DESIGN.md) are done). The UI is in Traditional Chinese. macOS is tested; Windows is not yet.

## Features

**Chat with the cat**
- Click the cat to type a question; the reply appears in a speech balloon above it.
- Double-click for a full chat window with Markdown rendering.
- Drag files or folders onto the cat to attach them, with quick actions like "summarize" or "translate".

**Works with the model you have**
- Any OpenAI-compatible endpoint: OpenAI, Azure OpenAI, OpenRouter, LiteLLM / One API gateways, Ollama, LM Studio, vLLM.
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
| Screenshot | macOS asks for Screen Recording permission once | Every time |

**Safety**
- Credential and browser-data locations (`~/.ssh`, `~/.aws`, Keychain, browser profiles…) are always blocked, even if you approve. Paths are symlink-resolved before checking, so links can't be used to get around this.
- "Allow for this conversation" grants last until you clear the chat.
- Every tool call is written to a local audit log.
- The conversation is saved locally and restored after a restart (images are not saved). Permission grants are not restored.
- File and web content is treated as data, not instructions, in the system prompt.

## Getting started

Requires Node.js 20 or later.

```bash
npm install
npm run dev
```

If `npm run dev` fails with `Error: Electron uninstall`, the Electron binary didn't download:

```bash
node node_modules/electron/install.js
```

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
| Right-click | Menu: chat, switch model, switch skin, clear chat, settings, quit |

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development mode with hot reload |
| `npm run start:mac` | Build and launch as a standalone app (macOS) |
| `npm test` | Run the test suite (Vitest; no Electron or network needed) |
| `npm run typecheck` | Type-check main, renderer and tests |
| `npm run build` | Build to `out/` |
| `npm run dist:mac` / `npm run dist:win` | Build installers (unsigned) |

## Project layout

```
src/
├── main/                 # Electron main process: model calls, keys, windows
│   ├── agent/            # Conversation and tool-calling loop, context management
│   ├── providers/        # OpenAI-compatible provider, fallback models
│   ├── tools/            # Built-in tools: files, shell, web, screenshot
│   ├── permissions/      # Permission checks, blocked paths, audit log
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

- **M3**: plugins compatible with the Claude ecosystem (MCP servers and `SKILL.md` skills), and tools declared in YAML
- **M4**: reminders, conversation history list, swappable animated skins, local-only mode for sensitive folders
- **M5**: signed installers, auto-update, audit log viewer

## Credits

The desk-slapping cat is original artwork drawn in SVG for this project, inspired by the "Bongo Cat" meme. It does not use the original Bongo Cat artwork.
