#!/usr/bin/env bash
# Install Bloud on Linux (Fedora, Bazzite, SteamOS, Ubuntu, etc.).
# Safe on immutable systems: everything goes under ~/.local — no rpm/dpkg required.
set -euo pipefail

VERSION="${BLOUD_VERSION:-}"
REPO="${BLOUD_GITHUB_REPO:-TheCodersRish/bloud}"
INSTALL_BIN="${HOME}/.local/bin"
APPIMAGE_HOME="${HOME}/.local/share/bloud"
DESKTOP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/256x256/apps"

usage() {
  cat <<'EOF'
Usage: install-bloud.sh [options]

Options:
  --from-source     Build an AppImage from this repo (requires Node.js 18+ and npm)
  --local           Install the newest AppImage from ./dist/ (after npm run dist:linux)
  --appimage PATH   Install a specific AppImage file
  -h, --help        Show this help

Environment:
  BLOUD_GITHUB_REPO   owner/repo for release downloads (e.g. myuser/bloud)
  BLOUD_VERSION       Pin a release tag (default: latest)

Examples:
  ./install-bloud.sh --local
  BLOUD_GITHUB_REPO=myuser/bloud ./install-bloud.sh
  curl -fsSL https://raw.githubusercontent.com/myuser/bloud/main/install-bloud.sh | bash
EOF
}

log() {
  printf '==> %s\n' "$*"
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

detect_arch() {
  local machine
  machine="$(uname -m)"
  case "$machine" in
    x86_64 | amd64) echo "x86_64" ;;
    aarch64 | arm64) echo "arm64" ;;
    *) die "Unsupported CPU architecture: $machine (need x86_64 or arm64)" ;;
  esac
}

script_dir() {
  local src="${BASH_SOURCE[0]}"
  while [[ -L "$src" ]]; do
    local dir
    dir="$(cd "$(dirname "$src")" && pwd)"
    src="$(readlink "$src")"
    [[ "$src" != /* ]] && src="$dir/$src"
  done
  cd "$(dirname "$src")" && pwd
}

resolve_repo() {
  if [[ -n "$REPO" ]]; then
    return
  fi
  local root
  root="$(script_dir)"
  if git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    local url
    url="$(git -C "$root" config --get remote.origin.url 2>/dev/null || true)"
    if [[ "$url" =~ github\.com[:/]([^/]+)/([^/.]+) ]]; then
      REPO="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
    fi
  fi
}

appimage_globs_for_arch() {
  local arch="$1"
  case "$arch" in
    x86_64) printf '%s\n' "Bloud-*-x64.AppImage" "Bloud-*-x86_64.AppImage" ;;
    arm64) printf '%s\n' "Bloud-*-arm64.AppImage" "Bloud-*-aarch64.AppImage" ;;
    *) die "Unknown arch: $arch" ;;
  esac
}

find_local_appimage() {
  local root arch
  root="$(script_dir)"
  arch="$(detect_arch)"
  local matches=() pattern
  shopt -s nullglob
  while IFS= read -r pattern; do
    matches+=("$root"/dist/$pattern)
  done < <(appimage_globs_for_arch "$arch")
  shopt -u nullglob
  if ((${#matches[@]} == 0)); then
    die "No AppImage in $root/dist/. Run: npm run dist:linux"
  fi
  local newest="${matches[0]}"
  local f
  for f in "${matches[@]}"; do
    [[ "$f" -nt "$newest" ]] && newest="$f"
  done
  printf '%s' "$newest"
}

download_release_appimage() {
  need_cmd curl
  resolve_repo
  [[ -n "$REPO" ]] || die "Set BLOUD_GITHUB_REPO=owner/repo or run from a git clone with GitHub origin"

  local arch api url asset_name tmp
  arch="$(detect_arch)"
  api="https://api.github.com/repos/${REPO}/releases"
  if [[ -n "$VERSION" ]]; then
    api="${api}/tags/${VERSION}"
  else
    api="${api}/latest"
  fi

  log "Fetching release metadata from GitHub ($REPO)..."
  local json
  json="$(curl -fsSL -H "Accept: application/vnd.github+json" "$api")"

  asset_name="$(printf '%s' "$json" | python3 -c '
import json, sys, fnmatch
arch = sys.argv[1]
patterns = {
    "x86_64": ["Bloud-*-x64.AppImage", "Bloud-*-x86_64.AppImage"],
    "arm64": ["Bloud-*-arm64.AppImage", "Bloud-*-aarch64.AppImage"],
}[arch]
data = json.load(sys.stdin)
for a in data.get("assets") or []:
    name = a.get("name") or ""
    for pat in patterns:
        if fnmatch.fnmatch(name, pat):
            print(name)
            sys.exit(0)
sys.exit(1)
' "$arch")" || die "No AppImage for $arch in this release. Build with: npm run dist:linux"

  url="$(printf '%s' "$json" | python3 -c '
import json, sys
want = sys.argv[1]
data = json.load(sys.stdin)
for a in data.get("assets") or []:
    if a.get("name") == want:
        print(a["browser_download_url"])
        sys.exit(0)
sys.exit(1)
' "$asset_name")"

  tmp="$(mktemp "${TMPDIR:-/tmp}/bloud.XXXXXX.AppImage")"
  log "Downloading $asset_name ..."
  curl -fsSL -o "$tmp" "$url"
  printf '%s' "$tmp"
}

build_from_source() {
  local root
  root="$(script_dir)"
  need_cmd npm
  need_cmd node
  log "Installing npm dependencies..."
  (cd "$root" && npm ci)
  log "Building Linux AppImage (this may take a few minutes)..."
  (cd "$root" && npm run dist:linux)
  find_local_appimage
}

write_desktop_entry() {
  local appimage="$1"
  mkdir -p "$DESKTOP_DIR" "$ICON_DIR"
  cat >"${DESKTOP_DIR}/bloud.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Bloud
Comment=Amazon Luna desktop client
Exec=${appimage} %U
Icon=bloud
Terminal=false
Categories=Game;
StartupWMClass=Bloud
EOF
  chmod 644 "${DESKTOP_DIR}/bloud.desktop"
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "${HOME}/.local/share/applications" 2>/dev/null || true
  fi
}

install_appimage() {
  local src="$1"
  [[ -f "$src" ]] || die "AppImage not found: $src"

  mkdir -p "$INSTALL_BIN" "$APPIMAGE_HOME"
  local dest="${APPIMAGE_HOME}/Bloud.AppImage"
  log "Installing AppImage to $dest"
  cp -f "$src" "$dest"
  chmod +x "$dest"

  local wrapper="${INSTALL_BIN}/bloud"
  cat >"$wrapper" <<EOF
#!/usr/bin/env bash
exec "${dest}" "\$@"
EOF
  chmod +x "$wrapper"

  write_desktop_entry "$dest"

  log "Done. Start Bloud from your app menu or run: bloud"
  if [[ ":$PATH:" != *":${INSTALL_BIN}:"* ]]; then
    printf '\nNote: add %s to your PATH (Bazzite/KDE often already includes ~/.local/bin):\n  echo export PATH="%s:\$PATH" >> ~/.bashrc\n' "$INSTALL_BIN" "$INSTALL_BIN"
  fi
  printf '\nFor passkey sign-in, install Google Chrome or Microsoft Edge (Flatpak or native).\n'
}

main() {
  [[ "$(uname -s)" == "Linux" ]] || die "This installer is for Linux only. On macOS use: npm install && npm start"

  local mode="release"
  local appimage_path=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --from-source) mode="source" ;;
      --local) mode="local" ;;
      --appimage)
        shift
        [[ $# -gt 0 ]] || die "--appimage requires a path"
        appimage_path="$1"
        mode="path"
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
    shift
  done

  case "$mode" in
    source)
      install_appimage "$(build_from_source)"
      ;;
    local)
      install_appimage "$(find_local_appimage)"
      ;;
    path)
      install_appimage "$appimage_path"
      ;;
    release)
      local tmp
      tmp="$(download_release_appimage)"
      trap 'rm -f "$tmp"' EXIT
      install_appimage "$tmp"
      ;;
  esac
}

main "$@"
