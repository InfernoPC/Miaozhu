# 喵助 (Miaozhu) — common tasks. `make help` lists them.
.DEFAULT_GOAL := help
SHELL := /bin/bash

help: ## List targets
	@grep -hE '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

node_modules: package-lock.json
	npm ci
	@touch node_modules

dev: node_modules ## Run the app with hot reload
	npm run dev

test: node_modules ## Run the tests
	npm test

typecheck: node_modules ## Type-check main and renderer
	npm run typecheck

build: node_modules ## Compile to out/
	npx electron-vite build

dist-mac: build ## Package macOS zips (arm64 + x64) into dist/
	npx electron-builder --mac --publish never

dist-win: build ## Package the Windows installer into dist/
	npx electron-builder --win --publish never

install: dist-mac ## Build and install to ~/Applications, the same way the one-line install does
	cd dist && shasum -a 256 Miaozhu-mac-*.zip > SHA256SUMS
	cd dist && (python3 -m http.server 8765 >/dev/null 2>&1 & echo $$! > .server.pid)
	sleep 1; MIAOZHU_BASE_URL=http://127.0.0.1:8765 bash scripts/install.sh; s=$$?; kill $$(cat dist/.server.pid); rm -f dist/.server.pid; exit $$s

release: ## Tag and push a release: make release VERSION=0.2.0
	@[ -n "$(VERSION)" ] || { echo "用法：make release VERSION=0.2.0"; exit 1; }
	@[ -z "$$(git status --porcelain)" ] || { echo "還有沒 commit 的變更"; exit 1; }
	@[ "$$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "請在 main 上發佈"; exit 1; }
	npm version $(VERSION) -m "Release v%s"
	git push origin main "v$(VERSION)"
	@echo "已推送 v$(VERSION)，進度：gh run watch"

clean: ## Remove build output
	rm -rf out dist

.PHONY: help dev test typecheck build dist-mac dist-win install release clean
