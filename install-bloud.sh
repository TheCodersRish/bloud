#!/bin/sh
# Install Bloud on Linux (Fedora, Bazzite, SteamOS, Ubuntu, etc.).
# Safe on immutable systems: everything goes under ~/.local — no rpm/dpkg required.
set -eu

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
  curl -fsSL https://raw.githubusercontent.com/TheCodersRish/bloud/main/install-bloud.sh | sh
EOF
}

log() {
  printf '==> %s\n' "$*" >&2
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

detect_arch() {
  machine="$(uname -m)"
  case "$machine" in
    x86_64 | amd64) echo "x86_64" ;;
    aarch64 | arm64) echo "arm64" ;;
    *) die "Unsupported CPU architecture: $machine (need x86_64 or arm64)" ;;
  esac
}

script_dir() {
  me="$0"
  case "$me" in
    /*) ;;
    *) me="$(pwd)/$me" ;;
  esac
  while [ -L "$me" ]; do
    link="$(readlink "$me")"
    case "$link" in
      /*) me="$link" ;;
      *) me="$(dirname "$me")/$link" ;;
    esac
  done
  dirname "$me"
}

resolve_repo() {
  if [ -n "$REPO" ]; then
    return 0
  fi
  root="$(script_dir)"
  if git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    url="$(git -C "$root" config --get remote.origin.url 2>/dev/null || true)"
    case "$url" in
      *github.com:*/*)
        REPO="$(printf '%s' "$url" | sed -n 's#.*github.com[:/]\([^/]*\)/\([^/.]*\).*#\1/\2#p' | head -n 1)"
        ;;
    esac
  fi
}

find_local_appimage() {
  root="$(script_dir)"
  arch="$(detect_arch)"
  newest=""
  case "$arch" in
    x86_64)
      patterns="Bloud-*-x64.AppImage Bloud-*-x86_64.AppImage"
      ;;
    arm64)
      patterns="Bloud-*-arm64.AppImage Bloud-*-aarch64.AppImage"
      ;;
    *)
      die "Unknown arch: $arch"
      ;;
  esac
  for pattern in $patterns; do
    for f in "$root"/dist/$pattern; do
      [ -f "$f" ] || continue
      if [ -z "$newest" ] || [ "$f" -nt "$newest" ]; then
        newest="$f"
      fi
    done
  done
  if [ -z "$newest" ]; then
    die "No AppImage in $root/dist/. Run: npm run dist:linux"
  fi
  printf '%s' "$newest"
}

download_release_appimage() {
  need_cmd curl
  need_cmd python3
  resolve_repo
  [ -n "$REPO" ] || die "Set BLOUD_GITHUB_REPO=owner/repo or run from a git clone with GitHub origin"

  arch="$(detect_arch)"
  api="https://api.github.com/repos/${REPO}/releases"
  if [ -n "$VERSION" ]; then
    api="${api}/tags/${VERSION}"
  else
    api="${api}/latest"
  fi

  log "Fetching release metadata from GitHub ($REPO)..."
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
  wrapper="$1"
  mkdir -p "$DESKTOP_DIR" "$ICON_DIR"
  cat >"${DESKTOP_DIR}/bloud.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Bloud
Comment=Amazon Luna desktop client
Exec=${wrapper} %U
TryExec=${wrapper}
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

install_launcher() {
  dest="$1"
  wrapper="${INSTALL_BIN}/bloud"
  mkdir -p "$INSTALL_BIN"
  cat >"$wrapper" <<EOF
#!/bin/sh
APPIMAGE="${dest}"
if [ ! -f "\$APPIMAGE" ]; then
  printf 'Bloud is not installed at %s\\n' "\$APPIMAGE" >&2
  printf 'Run: curl -fsSL https://raw.githubusercontent.com/TheCodersRish/bloud/main/install-bloud.sh | /bin/sh\\n' >&2
  exit 127
fi
chmod +x "\$APPIMAGE" 2>/dev/null || true
export APPIMAGE_EXTRACT_AND_RUN=1
exec "\$APPIMAGE" "\$@"
EOF
  chmod +x "$wrapper"
  printf '%s' "$wrapper"
}

verify_appimage() {
  path="$1"
  [ -f "$path" ] || die "Missing AppImage at $path"
  [ -s "$path" ] || die "AppImage at $path is empty — re-run the installer"
  if command -v file >/dev/null 2>&1; then
    kind="$(file -b "$path" 2>/dev/null || true)"
    case "$kind" in
      *AppImage* | *ELF* | *executable*) ;;
      *)
        die "File does not look like an AppImage: $path ($kind)"
        ;;
    esac
  fi
}

install_appimage() {
  src="$1"
  [ -f "$src" ] || die "AppImage not found: $src"

  mkdir -p "$INSTALL_BIN" "$APPIMAGE_HOME"
  dest="${APPIMAGE_HOME}/Bloud.AppImage"
  log "Installing AppImage to $dest"
  cp -f "$src" "$dest"
  chmod +x "$dest"
  verify_appimage "$dest"

  wrapper="$(install_launcher "$dest")"
  write_desktop_entry "$wrapper"

  log "Done. Start Bloud from your app menu or run:"
  printf '    %s\n' "$wrapper" >&2
  case ":$PATH:" in
    *":${INSTALL_BIN}:"*) ;;
    *)
      printf '\nNote: add %s to your PATH (Bazzite/KDE often already includes ~/.local/bin):\n  echo export PATH="%s:\$PATH" >> ~/.profile\n' "$INSTALL_BIN" "$INSTALL_BIN" >&2
      ;;
  esac
  printf '\nFor passkey sign-in, install Google Chrome or Microsoft Edge (Flatpak or native).\n' >&2
}

cleanup_tmp() {
  if [ -n "${TMP_APPIMAGE:-}" ] && [ -f "$TMP_APPIMAGE" ]; then
    rm -f "$TMP_APPIMAGE"
  fi
}

main() {
  [ "$(uname -s)" = "Linux" ] || die "This installer is for Linux only. On macOS use: npm install && npm start"

  mode="release"
  appimage_path=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --from-source) mode="source" ;;
      --local) mode="local" ;;
      --appimage)
        shift
        [ $# -gt 0 ] || die "--appimage requires a path"
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
      TMP_APPIMAGE="$(download_release_appimage)"
      # mktemp path must be the only stdout from download_release_appimage (logs go to stderr).
      case "$TMP_APPIMAGE" in
        /**.AppImage) ;;
        *)
          die "Internal error: bad download path (re-run installer). Got: $TMP_APPIMAGE"
          ;;
      esac
      trap cleanup_tmp EXIT
      install_appimage "$TMP_APPIMAGE"
      ;;
  esac
}

main "$@"
