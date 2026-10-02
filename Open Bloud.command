#!/bin/bash
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if [[ ! -d node_modules/electron/dist/Electron.app ]]; then
  echo "First-time setup: installing dependencies..."
  npm install
fi
open -a "/Applications/Bloud.app"
