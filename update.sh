#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

export PATH="$HOME/.bun/bin:$HOME/.local/share/pnpm:$PATH"

echo "==================================================="
echo "  multiagents - Update Script (macOS/Linux)        "
echo "==================================================="
echo

# 1. Pull git changes
if [ -d ".git" ]; then
  echo "[1/4] Pulling latest git changes..."
  if command -v git >/dev/null 2>&1; then
    git pull || echo "Git pull failed or has conflicts; continuing..."
  else
    echo "git command not found; skipping git pull."
  fi
else
  echo "[1/4] No .git directory found; skipping git pull."
fi
echo

# 2. Update dependencies
echo "[2/4] Updating project dependencies with pnpm..."
if command -v pnpm >/dev/null 2>&1; then
  pnpm install
else
  echo "WARNING: pnpm not found. Please run ./setup.sh."
fi
echo

# 3. Update Agent CLIs
echo "[3/4] Updating Agent CLIs..."
if command -v pnpm >/dev/null 2>&1; then
  pnpm add --global @openai/codex@latest @google/gemini-cli@latest || true
fi

if command -v claude >/dev/null 2>&1; then
  claude update 2>/dev/null || curl -fsSL https://claude.ai/install.sh | bash || true
fi
echo

# 4. Update Bun
echo "[4/4] Updating Bun..."
if command -v bun >/dev/null 2>&1; then
  bun upgrade || true
fi

echo
echo "==================================================="
echo "  Update completed successfully!                   "
echo "  Run ./start.sh to launch multiagents.            "
echo "==================================================="
