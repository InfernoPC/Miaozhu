#!/usr/bin/env bash
# Install or update Miaozhu (喵助) on macOS:
#   curl -fsSL https://raw.githubusercontent.com/InfernoPC/Miaozhu/main/scripts/install.sh | bash
#
# The app isn't signed with an Apple Developer certificate. Files downloaded with curl don't get
# the "downloaded from the internet" quarantine flag, so Gatekeeper doesn't block the app; it's
# ad-hoc signed so it runs on Apple Silicon. Installs into ~/Applications (no admin password).
#
# Environment overrides:
#   MIAOZHU_BASE_URL   where the release files are (default: latest GitHub release)
#   MIAOZHU_APP_DIR    install folder (default: ~/Applications)
#   MIAOZHU_NO_LAUNCH  set to 1 to skip opening the app afterwards
set -euo pipefail

REPO="InfernoPC/Miaozhu"
BASE="${MIAOZHU_BASE_URL:-https://github.com/$REPO/releases/latest/download}"
APP_DIR="${MIAOZHU_APP_DIR:-$HOME/Applications}"
APP="$APP_DIR/Miaozhu.app"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "這個腳本只支援 macOS。Windows 請用 install.ps1。"
case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) fail "不支援的處理器：$(uname -m)" ;;
esac
FILE="Miaozhu-mac-$ARCH.zip"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say "⬇️  下載喵助（${ARCH}）…"
curl -fL --progress-bar "$BASE/$FILE" -o "$TMP/$FILE" || fail "下載失敗：$BASE/$FILE"

# Verify against the published checksums when they're available.
if curl -fsSL "$BASE/SHA256SUMS" -o "$TMP/SHA256SUMS" 2>/dev/null; then
  expected="$(grep " $FILE\$" "$TMP/SHA256SUMS" | awk '{print $1}')"
  actual="$(shasum -a 256 "$TMP/$FILE" | awk '{print $1}')"
  [ -n "$expected" ] && [ "$expected" != "$actual" ] && fail "檔案檢查碼不符，已停止安裝（可能下載不完整，請再試一次）"
fi

say "📦 解壓縮…"
ditto -x -k "$TMP/$FILE" "$TMP/unpacked"
[ -d "$TMP/unpacked/Miaozhu.app" ] || fail "下載的檔案裡沒有 Miaozhu.app"

# Close the running copy so it can be replaced.
if pgrep -x Miaozhu >/dev/null 2>&1; then
  say "🐱 先關閉正在執行的喵助…"
  osascript -e 'quit app "Miaozhu"' >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -x Miaozhu >/dev/null 2>&1 || break; sleep 0.5; done
  pkill -x Miaozhu >/dev/null 2>&1 || true
fi

mkdir -p "$APP_DIR"
rm -rf "$APP"
mv "$TMP/unpacked/Miaozhu.app" "$APP"
# In case the zip came through a browser or chat app, which do add the flag.
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || echo '?')"
say "✅ 已安裝喵助 $VERSION 到 $APP"
[ "${MIAOZHU_NO_LAUNCH:-}" = "1" ] || open "$APP"
