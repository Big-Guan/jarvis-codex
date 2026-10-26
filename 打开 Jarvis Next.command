#!/bin/zsh
set -euo pipefail
project_dir=${0:A:h}
app="$project_dir/src-tauri/target/release/bundle/macos/Jarvis Next.app"
if [[ ! -d "$app" ]]; then
  print '请先在 jarvis-next 目录运行 npm ci && npm run build。'
  exit 1
fi
open "$app"
