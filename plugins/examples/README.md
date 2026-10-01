# Example plugins

`team-toolkit/` is a working plugin to copy from. Install it from **設定 → 外掛 → 從資料夾安裝**.

```
team-toolkit/
├── .claude-plugin/plugin.json          # name, version, description
├── skills/meeting-notes/
│   ├── SKILL.md                        # frontmatter name + description; loaded only when needed
│   └── references/template.md          # extra files the skill can read
└── tools/exchange-rate.yaml            # an HTTP tool declared in YAML, no code
```

## Adding an MCP server

Put a `.mcp.json` next to `.claude-plugin/` (same format as Claude Code):

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${CLAUDE_PLUGIN_ROOT}/data"]
    },
    "remote-example": { "type": "http", "url": "https://example.com/mcp" }
  }
}
```

`${CLAUDE_PLUGIN_ROOT}` is replaced with the plugin's installed folder. Every MCP tool call asks the user first.

## Declaring tools in YAML

| Field | Notes |
|---|---|
| `name` | Letters, digits, `_`, `-`; up to 64 characters; must not clash with built-in tools |
| `type` | `http` or `cli` |
| `description` | What it does; the model reads this to decide when to call it |
| `risk` | `read`, `network`, `write` or `execute` (default: `network` for http, `execute` for cli) |
| `input_schema` | JSON Schema for the arguments |
| `request` | http only: `method`, `url`, `headers`, `body`. `{param}` is filled from the arguments (URL-encoded in the URL); `${secret:name}` from secrets the user enters in settings |
| `command` | cli only: an argv array such as `["git", "log", "-n", "{count}"]`. Run without a shell, so arguments can't inject commands |
| `timeout_seconds` | Optional, default 30 |

Secret values are removed from tool output and errors before the model or the UI sees them.
