#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
project_dir=${script_dir:h}
helper_dir="$project_dir/src-tauri/wake-helper"
app_dir="$helper_dir/build.noindex/JarvisNextWake.app"
binary_dir="$app_dir/Contents/MacOS"
signing_identity=${APPLE_SIGNING_IDENTITY:--}
# Swift otherwise inherits the build machine's OS version, even when the host
# app targets an older macOS release.
macos_target=${MACOSX_DEPLOYMENT_TARGET:-14.0}
swift_target="$(/usr/bin/uname -m)-apple-macosx${macos_target}"

mkdir -p "$binary_dir"
cp "$helper_dir/Info.plist" "$app_dir/Contents/Info.plist"
/usr/bin/swiftc \
  -O \
  -target "$swift_target" \
  -framework AppKit \
  -framework AVFoundation \
  -framework Speech \
  "$helper_dir/JarvisWakeListener.swift" \
  -o "$binary_dir/JarvisNextWake"
/usr/bin/codesign \
  --force \
  --options runtime \
  --entitlements "$helper_dir/Entitlements.plist" \
  --sign "$signing_identity" \
  "$app_dir"

/usr/bin/swiftc -O -target "$swift_target" -framework AppKit -framework CoreGraphics \
  "$project_dir/src-tauri/native-helpers/NextDesktopMonitor.swift" \
  -o "$project_dir/src-tauri/native-helpers/NextDesktopMonitor"
/usr/bin/codesign --force --sign "$signing_identity" "$project_dir/src-tauri/native-helpers/NextDesktopMonitor"
