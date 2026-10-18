#!/usr/bin/env bash
# Keeps a public tunnel alive for the whole leg and publishes its URL to <state>/public_url.
#   NGROK_AUTHTOKEN set  -> ngrok. With NGROK_DOMAIN the link is fixed across legs.
#   no token             -> cloudflared quick tunnel (random link that changes).
# Usage: tunnel.sh <state_dir> <port>

STATE="$1"
PORT="$2"
LOG="$STATE/tunnel.log"
URL_FILE="$STATE/public_url"
: > "$LOG"

# Restarts the tunnel client whenever it exits.
run_tunnel() {
  while true; do
    if [ -n "${NGROK_AUTHTOKEN:-}" ]; then
      if [ -n "${NGROK_DOMAIN:-}" ]; then
        ngrok http "$PORT" --url "$NGROK_DOMAIN" --log=stdout >> "$LOG" 2>&1
      else
        ngrok http "$PORT" --log=stdout >> "$LOG" 2>&1
      fi
    else
      cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}" >> "$LOG" 2>&1
    fi
    echo "[tunnel] $(date -u +%T) client exited - restarting in 10s" >> "$LOG"
    sleep 10
  done
}

# Prints the current public https URL, or nothing if the tunnel is down.
find_url() {
  if [ -n "${NGROK_AUTHTOKEN:-}" ]; then
    curl -s -m 3 http://127.0.0.1:4040/api/tunnels \
      | jq -r '.tunnels[]?.public_url // empty' | grep '^https://' | head -1
  else
    grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | tail -1
  fi
}

run_tunnel &

missing=0
while true; do
  url="$(find_url)"
  if [ -n "$url" ]; then
    echo "$url" > "$URL_FILE"
    missing=0
  else
    rm -f "$URL_FILE"
    missing=$((missing + 1))
    if [ "$missing" -ge 18 ]; then            # no link for 3 minutes: bounce the client
      echo "[tunnel] $(date -u +%T) no link for 3 min - restarting the tunnel" >> "$LOG"
      pkill -x ngrok 2>/dev/null
      pkill -x cloudflared 2>/dev/null
      missing=0
    fi
  fi
  sleep 10
done
