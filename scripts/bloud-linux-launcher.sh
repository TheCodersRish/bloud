#!/bin/sh
# Launches the installed Bloud AppImage (works without FUSE on Bazzite / immutable distros).
APPIMAGE="${BLOUD_APPIMAGE:-${HOME}/.local/share/bloud/Bloud.AppImage}"

if [ ! -f "$APPIMAGE" ]; then
  printf 'Bloud is not installed at %s\n' "$APPIMAGE" >&2
  printf 'Install with:\n  curl -fsSL https://raw.githubusercontent.com/TheCodersRish/bloud/main/install-bloud.sh | /bin/sh\n' >&2
  exit 127
fi

if [ ! -x "$APPIMAGE" ]; then
  chmod +x "$APPIMAGE" 2>/dev/null || true
fi

# Avoid FUSE / mount issues common on gaming images and minimal PATH in desktop sessions.
export APPIMAGE_EXTRACT_AND_RUN=1
exec "$APPIMAGE" "$@"
