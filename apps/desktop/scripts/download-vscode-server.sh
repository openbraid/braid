#!/bin/bash
# Downloads the web server build of VS Code that Braid embeds.
# Run once after cloning: npm run setup:vscode-server
#
# Defaults to Microsoft's build. VSCodium (MIT, redistributable) is also
# supported but not yet verified with Braid:
#
#   BRAID_VSCODE_FLAVOR=vscodium npm run setup:vscode-server
#
# Both layouts are identical apart from the binary name (code-server vs
# codium-server), which is symlinked below so the app does not need to care.

set -e

DEST="resources/vscode-server"
BIN_DIR="$DEST/bin"
BINARY="$BIN_DIR/code-server"

if [ -f "$BINARY" ]; then
  echo "VS Code server already present at $BINARY — skipping download."
  echo "Delete $DEST to re-download."
  exit 0
fi

ARCH=$(uname -m)
OS=$(uname -s)

if [ "${BRAID_VSCODE_FLAVOR:-microsoft}" = "vscodium" ]; then
  if [ "$OS" = "Darwin" ]; then
    [ "$ARCH" = "arm64" ] && PLATFORM="darwin-arm64" || PLATFORM="darwin-x64"
  elif [ "$OS" = "Linux" ]; then
    [ "$ARCH" = "aarch64" ] && PLATFORM="linux-arm64" || PLATFORM="linux-x64"
  else
    echo "Unsupported OS: $OS"
    exit 1
  fi

  echo "Resolving latest VSCodium release..."
  TAG=$(curl -fsSL https://api.github.com/repos/VSCodium/vscodium/releases/latest \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)

  if [ -z "$TAG" ]; then
    echo "Could not resolve the latest VSCodium release (GitHub API rate limit?)."
    echo "Set VSCODIUM_TAG=<version> to pin one, e.g. VSCODIUM_TAG=1.126.04524"
    exit 1
  fi
  TAG="${VSCODIUM_TAG:-$TAG}"

  ASSET="vscodium-reh-web-${PLATFORM}-${TAG}.tar.gz"
  URL="https://github.com/VSCodium/vscodium/releases/download/${TAG}/${ASSET}"

  TMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TMP_DIR"' EXIT

  echo "Downloading VSCodium reh-web ${TAG} (${PLATFORM})..."
  curl -fL --progress-bar "$URL" -o "$TMP_DIR/server.tar.gz"

  echo "Extracting..."
  mkdir -p "$DEST"
  # The tarball has no top-level directory — its contents are the server root.
  tar xzf "$TMP_DIR/server.tar.gz" -C "$DEST"

  # The app spawns bin/code-server regardless of flavour.
  if [ ! -f "$BINARY" ] && [ -f "$BIN_DIR/codium-server" ]; then
    ln -sf codium-server "$BINARY"
  fi
  chmod +x "$BIN_DIR/codium-server" 2>/dev/null || true

  echo "Done. VSCodium server installed at: $BINARY"
  exit 0
fi

# ─── Microsoft (default) ──────────────────────────────────────────────────────

if [ "$OS" = "Darwin" ]; then
  [ "$ARCH" = "arm64" ] && MS_PLATFORM="server-darwin-arm64-web" || MS_PLATFORM="server-darwin-x64-web"
elif [ "$OS" = "Linux" ]; then
  [ "$ARCH" = "aarch64" ] && MS_PLATFORM="server-linux-arm64-web" || MS_PLATFORM="server-linux-x64-web"
else
  echo "Unsupported OS: $OS"
  exit 1
fi

echo "Downloading VS Code server (${MS_PLATFORM})..."

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fL --progress-bar "https://update.code.visualstudio.com/latest/${MS_PLATFORM}/stable" \
  -o "$TMP_DIR/server.zip"
unzip -q "$TMP_DIR/server.zip" -d "$TMP_DIR/extracted"
EXTRACTED_DIR=$(find "$TMP_DIR/extracted" -maxdepth 1 -mindepth 1 -type d | head -1)

mkdir -p "$DEST"
cp -r "$EXTRACTED_DIR/"* "$DEST/"
chmod +x "$BINARY"

echo "Done. VS Code server installed at: $BINARY"
