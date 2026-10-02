# Spike: meme gallery clipboard

Not app code. Checks whether Electron 44's clipboard API can copy a *file* (so an animated
GIF pastes into chat apps as a file that still moves) on macOS and Windows.

```bash
npx electron spike/clipboard-spike.cjs   # prints SPIKE_REPORT {...}
```

Windows runs in GitHub Actions (`.github/workflows/spike-clipboard.yml`, spike branches only).
