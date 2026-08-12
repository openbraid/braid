#!/bin/bash
# Installs dependencies, compiles and installs the braid VS Code extension
# into ~/.braid/vscode-extensions/ so the VS Code server picks it up automatically.
# Run once after cloning, or after changing extension source:
#   npm run setup:extension

set -e

EXTENSION_DIR="src/extension"
EXTENSIONS_INSTALL_DIR="$HOME/.braid/vscode-extensions"
EXTENSION_VERSION=$(node -p "require('./${EXTENSION_DIR}/package.json').version")
EXTENSION_NAME=$(node -p "require('./${EXTENSION_DIR}/package.json').name")
EXTENSION_INSTALL_NAME="braid.${EXTENSION_NAME}-${EXTENSION_VERSION}"
EXTENSIONS_JSON="$EXTENSIONS_INSTALL_DIR/extensions.json"

if [ ! -d "$EXTENSION_DIR" ]; then
  echo "Extension directory not found: $EXTENSION_DIR"
  exit 1
fi

echo "Installing extension dependencies..."
npm install --prefix "$EXTENSION_DIR"

echo "Compiling extension TypeScript..."
npm run compile --prefix "$EXTENSION_DIR"

echo "Installing extension into $EXTENSIONS_INSTALL_DIR/$EXTENSION_INSTALL_NAME ..."
DEST="$EXTENSIONS_INSTALL_DIR/$EXTENSION_INSTALL_NAME"
rm -rf "$DEST"
mkdir -p "$DEST"
cp "$EXTENSION_DIR/package.json" "$DEST/"
cp -r "$EXTENSION_DIR/out" "$DEST/"
cp -r "$EXTENSION_DIR/node_modules" "$DEST/"
if [ -d "$EXTENSION_DIR/media" ]; then
  cp -r "$EXTENSION_DIR/media" "$DEST/"
fi

echo "Registering extension in extensions.json ..."
TIMESTAMP=$(date +%s000)
cat > "$EXTENSIONS_JSON" << EOF
[
  {
    "identifier": { "id": "braid.${EXTENSION_NAME}" },
    "version": "${EXTENSION_VERSION}",
    "location": { "\$mid": 1, "path": "${DEST}", "scheme": "file" },
    "relativeLocation": "${EXTENSION_INSTALL_NAME}",
    "metadata": {
      "isApplicationScoped": false,
      "isMachineScoped": false,
      "isBuiltin": false,
      "installedTimestamp": ${TIMESTAMP},
      "pinned": true,
      "source": "vsix"
    }
  }
]
EOF

# Clear VS Code's extension manifest cache so it re-reads package.json fresh on next start
CACHE_FILE="$HOME/.braid/vscode-user-data/data/CachedProfilesData/__default__profile__/extensions.user.cache"
if [ -f "$CACHE_FILE" ]; then
  rm -f "$CACHE_FILE"
  echo "Cleared extension manifest cache."
fi

echo "Done. Extension installed at: $DEST"
