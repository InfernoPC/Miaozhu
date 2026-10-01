# Skin packs

A skin pack changes the character on the desktop. Install one from **設定 → 角色 → 外觀 → 從資料夾安裝造型** (or from a zip), or switch from the pet's right-click menu.

`examples/night-cat/` is a working pack to copy from.

## Format

A folder with a `skin.json` and one file per state:

```json
{
  "name": "夜貓",
  "author": "Your name",
  "renderer": "images",
  "width": 200,
  "height": 180,
  "states": {
    "idle": "idle.png",
    "thinking": "thinking.gif",
    "talking": "talking.webp"
  }
}
```

| Field | Notes |
|---|---|
| `name` | Shown in settings and the menu |
| `renderer` | `images` (one image per state: png, jpg, gif, webp, svg; animated gif/webp play) or `lottie` (one Lottie `.json` animation per state, looped) |
| `width`, `height` | Display size in pixels, 40–400. Default 200 × 180 |
| `states` | Map of state → file inside the pack. `idle` is required; any state left out uses `idle` |

## States

| State | When |
|---|---|
| `idle` | Waiting |
| `listening` | The input box is open, or a file is dragged over the character |
| `thinking` | Waiting for the model |
| `talking` | The reply is streaming in |
| `working` | A tool is running (reading files, searching…) |
| `alert` | Asking for permission, or a reminder is due |
| `sleeping` | No activity for 5 minutes |
| `error` | Something went wrong |

## Limits

- Each file up to 5 MB, and every file must be inside the pack folder (no `..`, no links pointing out).
- Lottie animations use the light player (SVG renderer, no expressions), so animations that depend on After Effects expressions won't play correctly. Export without expressions.
- SVG images are shown as images: scripts inside them don't run.
- Leave transparent space around the character: clicks on transparent pixels of the image itself still count as the character, so keep the canvas close to the drawing.
