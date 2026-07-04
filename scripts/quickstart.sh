#!/usr/bin/env bash
#
# CC Flight -- Quickstart script
# -------------------------------
# Clones or enters the CC Flight repo, installs dependencies, and starts
# both the API server and the Vite dev server in one command.
#
# Usage:
#   bash quickstart.sh          # full flow
#   bash quickstart.sh --help   # show this message and exit

set -e

REPO_URL="https://github.com/TheAceTeam/CC-Flight.git"
REPO_DIR="CC-Flight"
API_PORT="${SUPERVIEW_API_PORT:-5174}"
UI_PORT="${SUPERVIEW_UI_PORT:-5173}"
UI_HOST="127.0.0.1"

# ------------------------------------------------------------------
# Help
# ------------------------------------------------------------------
show_help() {
  cat <<EOF
CC Flight Quickstart

Clones (or enters) the CC Flight repository, installs dependencies, and
starts the development servers.

USAGE
  curl -fsSL ${REPO_URL%.git}/raw/main/scripts/quickstart.sh | bash
  bash quickstart.sh
  bash quickstart.sh --help

WHAT IT DOES
  1. Checks prerequisites (Node.js >= 18, pnpm).
  2. Clones the repo if the current directory is not already inside it.
  3. Runs \`pnpm install\`.
  4. Starts the Express API server in the background.
  5. Starts the Vite dev server in the foreground.
  6. Opens your browser to http://${UI_HOST}:${UI_PORT}/.

ENVIRONMENT
  SUPERVIEW_API_PORT   API server port (default: ${API_PORT})
  SUPERVIEW_UI_PORT    UI dev server port (default: ${UI_PORT})

SIGNALS
  Ctrl-C stops both the UI and API servers.

EOF
  exit 0
}

# ------------------------------------------------------------------
# Parse flags
# ------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --help|-h) show_help ;;
  esac
done

# ------------------------------------------------------------------
# Color helpers
# ------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { printf "${CYAN}[info]${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}[ ok ]${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}[warn]${NC} %s\n" "$*"; }
err()   { printf "${RED}[error]${NC} %s\n" "$*"; }

# ------------------------------------------------------------------
# Prerequisites
# ------------------------------------------------------------------
info "Checking prerequisites..."

# Node.js >= 18
if ! command -v node &>/dev/null; then
  err "Node.js is not installed. Please install Node.js >= 18 first."
  err "  https://nodejs.org/"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node.js >= 18 is required, but found $(node --version)."
  err "Upgrade Node.js and try again."
  exit 1
fi
ok "Node.js $(node --version)"

# pnpm
if command -v pnpm &>/dev/null; then
  PNPM_CMD="pnpm"
  ok "pnpm v$(pnpm --version)"
elif command -v npm &>/dev/null; then
  warn "pnpm not found -- falling back to npm (pnpm is recommended)."
  warn "Install pnpm: npm install -g pnpm"
  PNPM_CMD="npm"
else
  err "Neither pnpm nor npm was found. Please install Node.js >= 18 first."
  exit 1
fi

# ------------------------------------------------------------------
# Repo setup
# ------------------------------------------------------------------
is_in_repo() {
  # Heuristic: current directory contains a package.json with "cc-flight".
  if [ -f "package.json" ] && grep -q '"cc-flight"' package.json 2>/dev/null; then
    return 0
  fi
  return 1
}

if is_in_repo; then
  info "Already inside the CC Flight repo. Skipping clone."
else
  # Not in the repo -- clone (or enter an existing clone in a subdir).
  if [ -d "$REPO_DIR" ]; then
    info "Found existing ./${REPO_DIR} directory. Using it."
    cd "$REPO_DIR"
  else
    info "Cloning CC Flight from ${REPO_URL}..."
    if ! git clone --depth 1 "$REPO_URL" 2>/dev/null; then
      # If git is not available or the clone fails, offer a fallback message.
      err "Failed to clone repository."
      err "Make sure git is installed and you have internet access."
      err "Manual alternative:"
      err "  git clone $REPO_URL"
      err "  cd $REPO_DIR"
      err "  pnpm install && pnpm dev"
      exit 1
    fi
    ok "Repository cloned."
    cd "$REPO_DIR"
  fi
fi

# Confirm we are where we think we are (safety check).
if [ ! -f "package.json" ]; then
  err "Something went wrong -- no package.json found in $(pwd)."
  exit 1
fi

# ------------------------------------------------------------------
# Install dependencies
# ------------------------------------------------------------------
info "Installing dependencies (${PNPM_CMD} install)..."
$PNPM_CMD install
ok "Dependencies installed."

# ------------------------------------------------------------------
# Cleanup handler
# ------------------------------------------------------------------
SERVER_PID=""
cleanup() {
  echo ""
  warn "Shutting down..."
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
  ok "Stopped."
  exit 0
}
trap cleanup SIGINT SIGTERM

# ------------------------------------------------------------------
# Start API server (background)
# ------------------------------------------------------------------
info "Starting API server on http://${UI_HOST}:${API_PORT}..."
$PNPM_CMD dev:server &
SERVER_PID=$!

# Give the server a moment to start, but don't wait too long.
# We'll check readiness in a loop (up to 10 seconds).
info "Waiting for API server to be ready..."
READY=false
for i in $(seq 1 20); do
  if curl -s "http://${UI_HOST}:${API_PORT}/api/health" >/dev/null 2>&1; then
    READY=true
    break
  fi
  sleep 0.5
done

if [ "$READY" = true ]; then
  ok "API server is running at http://${UI_HOST}:${API_PORT}"
else
  warn "API server may not be fully ready yet. Check http://${UI_HOST}:${API_PORT}/api/health"
fi

# ------------------------------------------------------------------
# Open browser
# ------------------------------------------------------------------
UI_URL="http://${UI_HOST}:${UI_PORT}"
info "Opening ${UI_URL} in your browser..."

case "$(uname -s)" in
  Linux)   xdg-open "$UI_URL" 2>/dev/null || true ;;
  Darwin)  open "$UI_URL" 2>/dev/null || true ;;
  CYGWIN*|MINGW*|MSYS*) start "$UI_URL" 2>/dev/null || true ;;
  *)       info "Please open ${UI_URL} manually." ;;
esac

# ------------------------------------------------------------------
# Start UI dev server (foreground)
# ------------------------------------------------------------------
info "Starting UI dev server..."
echo ""
printf "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
printf "${GREEN}  CC Flight is starting up!${NC}\n"
printf "${GREEN}  Open ${UI_URL} in your browser.${NC}\n"
printf "${GREEN}  Press Ctrl-C to stop all servers.${NC}\n"
printf "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
echo ""

$PNPM_CMD dev:client
