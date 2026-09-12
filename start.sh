#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

export PATH="$HOME/.bun/bin:$HOME/.local/share/pnpm:$PATH"

MULTIAGENTS_PORT="${MULTIAGENTS_PORT:-7899}"
MULTIAGENTS_WEB_PORT="${MULTIAGENTS_WEB_PORT:-${WEB_PORT:-7900}}"

if ! command -v bun >/dev/null 2>&1; then
  echo "ERROR: Bun was not found. Please run ./setup.sh first."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "ERROR: node_modules not found. Please run ./setup.sh first."
  exit 1
fi

if [ "$MULTIAGENTS_PORT" = "$MULTIAGENTS_WEB_PORT" ]; then
  echo "ERROR: Broker and dashboard ports must differ."
  exit 1
fi

echo "Bun: $(which bun) ($(bun --version))"
echo "Broker port: $MULTIAGENTS_PORT; dashboard port: $MULTIAGENTS_WEB_PORT"

is_port_listening() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -i :"$port" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  else
    # Fallback probe via Bun
    bun -e "try { const s = await Bun.connect({ hostname: '127.0.0.1', port: Number(process.argv[2]), socket: { data(){}, open(s){ s.end(); process.exit(0); }, error(){ process.exit(1); } } }); } catch { process.exit(1); }" "$port" >/dev/null 2>&1
  fi
}

wait_for_service() {
  local port="$1"
  local kind="$2"
  local url
  if [ "$kind" = "broker" ]; then
    url="http://127.0.0.1:${port}/health"
  else
    url="http://127.0.0.1:${port}/"
  fi

  bun -e "
    const isBroker = process.argv[2] === 'broker';
    const url = process.argv[3];
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(750) });
        if (r.ok) {
          if (isBroker) {
            const j = await r.json();
            if (j.status === 'ok') process.exit(0);
          } else {
            const t = await r.text();
            if (t.includes('<title>multiagents dashboard</title>')) process.exit(0);
          }
        }
      } catch {}
      await Bun.sleep(250);
    }
    console.error('ERROR: Service did not become ready at ' + url);
    process.exit(1);
  " "$kind" "$url"
}

# 1. Broker
if is_port_listening "$MULTIAGENTS_PORT"; then
  echo "Reusing existing listener on port $MULTIAGENTS_PORT for broker..."
else
  echo "Starting broker on port $MULTIAGENTS_PORT..."
  nohup bun broker.ts >/dev/null 2>&1 &
fi
wait_for_service "$MULTIAGENTS_PORT" "broker"

# 2. Dashboard
if is_port_listening "$MULTIAGENTS_WEB_PORT"; then
  echo "Reusing existing listener on port $MULTIAGENTS_WEB_PORT for dashboard..."
else
  echo "Starting dashboard on port $MULTIAGENTS_WEB_PORT..."
  nohup bun dashboard/server.ts >/dev/null 2>&1 &
fi
wait_for_service "$MULTIAGENTS_WEB_PORT" "dashboard"

DASHBOARD_URL="http://127.0.0.1:${MULTIAGENTS_WEB_PORT}"
echo "Dashboard ready at $DASHBOARD_URL"

# 3. Open browser
if [[ "$OSTYPE" == "darwin"* ]]; then
  open "$DASHBOARD_URL" || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$DASHBOARD_URL" >/dev/null 2>&1 || true
else
  echo "Please open $DASHBOARD_URL in your browser."
fi
