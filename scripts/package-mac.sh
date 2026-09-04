#!/usr/bin/env bash
# 打 macOS arm64 安装包：electron-builder 构建 → ad-hoc 签名 → ditto 压缩（保留签名与资源）。
# 为什么要 ad-hoc 签名：Apple Silicon 上完全无签名的 App 会被 Gatekeeper 直接报"已损坏"，右键打开也无效；
# ad-hoc 签名后只剩"无法验证开发者"，用户用 xattr 或「仍要打开」即可放行。无需开发者账号。
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
APP="dist/mac-arm64/TradeGenuis Options.app"
ZIP="dist/TradeGenuis Options-${VERSION}-arm64-mac.zip"
npx electron-builder --mac --dir --arm64
codesign --force --deep --sign - --timestamp=none "$APP"
codesign --verify --deep --strict "$APP"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
echo "OK: $ZIP ($(du -h "$ZIP" | cut -f1))"
echo "发布: gh release create v${VERSION} \"$ZIP\" --title \"TradeGenuis Options v${VERSION}\" --notes-file RELEASE_NOTES.md"
