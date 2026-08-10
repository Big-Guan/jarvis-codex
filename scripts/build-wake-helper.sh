#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
project_dir=${script_dir:h}
helper_dir="$project_dir/src-tauri/wake-helper"
app_dir="$helper_dir/JarvisWakeListener.app"
binary_dir="$app_dir/Contents/MacOS"
signing_identity=${APPLE_SIGNING_IDENTITY:--}

mkdir -p "$binary_dir"
cp "$helper_dir/Info.plist" "$app_dir/Contents/Info.plist"
/usr/bin/swiftc \
  -O \
  -framework AppKit \
  -framework AVFoundation \
  -framework Speech \
  "$helper_dir/JarvisWakeListener.swift" \
  -o "$binary_dir/JarvisWakeListener"
xattr -cr "$app_dir" 2>/dev/null || true
/usr/bin/codesign \
  --force \
  --options runtime \
  --entitlements "$helper_dir/Entitlements.plist" \
  --sign "$signing_identity" \
  "$app_dir"
