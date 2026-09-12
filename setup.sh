#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "==================================================="
echo "  multiagents - Environment & Prerequisites Setup  "
echo "==================================================="
echo

# 1. Check or install Bun
echo "[1/5] Checking Bun..."
export PATH="$HOME/.bun/bin:$PATH"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun was not found. Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "ERROR: Bun installation finished but bun command was not found."
  exit 1
fi
echo "Bun $(bun --version) OK."
echo

# 2. Check or install Node.js (>=20)
echo "[2/5] Checking Node.js..."
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
  if [ "$NODE_MAJOR" -ge 20 ]; then
    NODE_OK=1
  fi
fi

if [ "$NODE_OK" -eq 0 ]; then
  echo "Node.js 20+ required. Please install Node.js 20 or newer via your package manager:"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "  brew install node"
  else
    echo "  sudo apt update && sudo apt install -y nodejs npm   (or use nvm/fnm)"
  fi
fi
echo "Node.js OK."
echo

# 3. Check or install pnpm
echo "[3/5] Checking pnpm..."
export PNPM_HOME="$HOME/.local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found. Installing pnpm..."
  if command -v npm >/dev/null 2>&1; then
    npm install -g pnpm || curl -fsSL https://get.pnpm.io/install.sh | sh -
  else
    curl -fsSL https://get.pnpm.io/install.sh | sh -
  fi
  export PATH="$PNPM_HOME:$PATH"
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERROR: pnpm was not found. Please ensure pnpm is installed."
  exit 1
fi
echo "pnpm $(pnpm --version) OK."
echo

# 4. Install project dependencies
echo "[4/5] Installing project dependencies with pnpm..."
pnpm install
echo "Dependencies OK."
echo

# 5. Check or install Agent CLIs
echo "[5/5] Checking and installing Agent CLIs..."

# Claude Code
if command -v claude >/dev/null 2>&1; then
  echo "[OK] Claude Code: $(which claude)"
else
  echo "Installing Claude Code..."
  curl -fsSL https://claude.ai/install.sh | bash || echo "[NOTE] Could not install Claude Code automatically. You can install it later."
fi

# Codex CLI
if command -v codex >/dev/null 2>&1; then
  echo "[OK] Codex CLI: $(which codex)"
else
  echo "Installing Codex CLI via pnpm..."
  pnpm add --global @openai/codex || echo "[NOTE] Could not install Codex CLI."
fi

# Gemini CLI
if command -v gemini >/dev/null 2>&1; then
  echo "[OK] Gemini CLI: $(which gemini)"
else
  echo "Installing Gemini CLI via pnpm..."
  pnpm add --global @google/gemini-cli || echo "[NOTE] Could not install Gemini CLI."
fi

echo
echo "==================================================="
echo "  Setup completed successfully!                    "
echo "  Run ./start.sh to launch multiagents.            "
echo "==================================================="
