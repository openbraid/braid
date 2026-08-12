#!/bin/bash
# Braid workspace setup — runs after worktree creation
# Installs dependencies and builds assets needed for the app to run

set -e

echo "Installing dependencies..."
npm install --legacy-peer-deps

echo "Setting up VS Code server..."
npm run setup:vscode-server

echo "Building VS Code extension..."
npm run setup:extension

echo "Building embedded terminal..."
npm run build:embedded-terminal

echo "Setup complete."
