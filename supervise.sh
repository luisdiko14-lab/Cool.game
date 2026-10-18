#!/usr/bin/env bash
# Runs neon_swarm.py for one leg of the chain.
#   * restarts the game after crashes (with backoff), hangs and memory blow-ups
#   * hot-reloads when new commits land on the branch (same run, same link)
#   * stops cleanly (Ctrl+C first, so the game can save) when the leg's deadline arrives
# Expects from the workflow: PORT, SWARM_DEADLINE (epoch seconds), MAX_RSS_MB, LEG, LEGS_TOTAL

STATE="${RUNNER_TEMP:-/tmp}/neon"
mkdir -p "$STATE"
GAME_LOG="$STATE/game.log"
EVENTS="$STATE/events.log"
PIDF="$STATE/game.pid"
RELOAD="$STATE/reload.flag"
STOP="$STATE/stop.flag"
BRANCH="${GITHUB_REF_NAME:-main}"
: > "$GAME_LOG"
: > "$EVENTS"
rm -f "$RELOAD" "$STOP"

ev() { echo "$(date -u +%T)  $*" | tee -a "$EVENTS"; }

game_pid() { cat "$PIDF" 2>/dev/null; }

# True while the game (or anything in its process group) is still running.
alive() {
  local pid
  pid="$(game_pid)"
  [ -n "$pid" ] && { kill -0 -- "-$pid" 2>/dev/null || kill -0 "$pid" 2>/dev/null; }
}

# Send a signal to the game's whole process group, falling back to the pid.
send() {
  local pid
  pid="$(game_pid)"
  [ -n "$pid" ] || return 0
  kill -"$1" -- "-$pid" 2>/dev/null || kill -"$1" "$pid" 2>/dev/null
  return 0
}

# Ctrl+C first (lets the game save its leaderboard), then escalate.
stop_game() {
  alive || return 0
  send INT
  for _ in $(seq 1 15); do alive || return 0; sleep 1; done
  send TERM
  for _ in $(seq 1 5); do alive || return 0; sleep 1; done
  send KILL
  return 0
}

start_game() {
  rm -f "$RELOAD"
  if [ -s "$STATE/wake.pid" ]; then        # free the port from the waking page
    kill "$(cat "$STATE/wake.pid")" 2>/dev/null
    rm -f "$STATE/wake.pid"
  fi
  # setsid gives the game its own process group, so stops reach every child it spawns
  ( trap - INT; exec setsid python -u neon_swarm.py ) >> "$GAME_LOG" 2>&1 &
  GAME_PID=$!
  echo "$GAME_PID" > "$PIDF"
}

# ---------------------------------------------------------------- watchers

# Every minute: fetch the branch. New commits fast-forward in and the game reloads.
watch_repo() {
  while sleep 60; do
    git fetch --quiet origin "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}" 2>/dev/null || continue
    local_sha="$(git rev-parse HEAD)"
    remote_sha="$(git rev-parse "refs/remotes/origin/${BRANCH}")"
    [ "$local_sha" = "$remote_sha" ] && continue
    changed="$(git diff --name-only "$local_sha" "$remote_sha")"
    if ! git merge --ff-only --quiet "refs/remotes/origin/${BRANCH}" 2>/dev/null; then
      ev "[hot-reload] cannot fast-forward to ${remote_sha:0:7} (local changes?) - skipped"
      continue
    fi
    if echo "$changed" | grep -q '^requirements.*\.txt$' && [ -f requirements.txt ]; then
      ev "[hot-reload] requirements changed - installing them"
      python -m pip install --prefer-binary -r requirements.txt >> "$STATE/pip-hot.log" 2>&1 \
        || ev "[hot-reload] pip install failed - see logs/pip-hot.log"
    fi
    if echo "$changed" | grep -qvE '\.md$|^\.github/|^LICENSE'; then
      ev "[hot-reload] new commit ${remote_sha:0:7} on ${BRANCH} - reloading the game"
      touch "$RELOAD"
      stop_game
    else
      ev "[hot-reload] docs-only commit ${remote_sha:0:7} - no restart needed"
    fi
  done
}

# Every 30 s: if the game stops answering for 3 minutes, it is hung, so restart it.
watch_health() {
  local fails=0 code
  while sleep 30; do
    if ! alive; then fails=0; continue; fi
    code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:${PORT}/" 2>/dev/null)"
    if [ -z "$code" ] || [ "$code" = "000" ]; then
      fails=$((fails + 1))
      if [ "$fails" -ge 6 ]; then
        ev "[health] no answer on port ${PORT} for 3 minutes - restarting the game"
        stop_game
        fails=0
      fi
    else
      fails=0
    fi
  done
}

# Every minute: restart the game if its memory use passes MAX_RSS_MB.
watch_memory() {
  local rss_kb rss_mb
  while sleep 60; do
    alive || continue
    rss_kb="$(ps -o rss= -p "$(game_pid)" 2>/dev/null | tr -d ' ')"
    [ -n "$rss_kb" ] || continue
    rss_mb=$((rss_kb / 1024))
    if [ "$rss_mb" -gt "${MAX_RSS_MB:-6144}" ]; then
      ev "[memory] game uses ${rss_mb} MB (limit ${MAX_RSS_MB} MB) - restarting it"
      stop_game
    fi
  done
}

# Every 5 minutes: one status line for the log.
heartbeat() {
  while sleep 300; do
    local state="down"
    alive && state="running"
    ev "[heartbeat] leg ${LEG}/${LEGS_TOTAL} | game ${state} | link $(cat "$STATE/public_url" 2>/dev/null || echo none) | load $(cut -d' ' -f1 /proc/loadavg) | free RAM $(free -m | awk '/Mem:/{print $7}') MB"
  done
}

# Sleep until the leg deadline, then stop cleanly.
deadline_timer() {
  local left=$(( SWARM_DEADLINE - $(date +%s) ))
  [ "$left" -gt 0 ] && sleep "$left"
  ev "[deadline] this leg's time is up - stopping cleanly so the next leg takes over"
  touch "$STOP"
  stop_game
}

cleanup() {
  touch "$STOP"
  stop_game
  pkill -P $$ 2>/dev/null
  ev "[shutdown] game and watchers stopped"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# ---------------------------------------------------------------- main loop

ev "[supervisor] leg ${LEG}/${LEGS_TOTAL} online - stops in $(( (SWARM_DEADLINE - $(date +%s)) / 60 )) min"

tail -n +1 -F "$GAME_LOG" | grep --line-buffered -v 'HTTP/1.1"' &
watch_repo &
watch_health &
watch_memory &
heartbeat &
deadline_timer &

crashes=0
backoff=2
while [ ! -f "$STOP" ] && [ "$(date +%s)" -lt "$SWARM_DEADLINE" ]; do
  started=$(date +%s)
  start_game
  ev "[supervisor] neon_swarm.py running (pid ${GAME_PID})"
  wait "$GAME_PID"
  code=$?
  kill -KILL -- "-$GAME_PID" 2>/dev/null     # clear any leftover children
  [ -f "$STOP" ] && break
  if [ -f "$RELOAD" ]; then
    ev "[supervisor] restarting with the newest code"
    backoff=2
    continue
  fi
  ran=$(( $(date +%s) - started ))
  [ "$ran" -gt 300 ] && backoff=2          # ran a while, so this was not a crash loop
  crashes=$((crashes + 1))
  ev "[supervisor] crash #${crashes}: exit code ${code} after ${ran}s - restarting in ${backoff}s"
  sleep "$backoff"
  backoff=$(( backoff * 2 > 60 ? 60 : backoff * 2 ))
done
ev "[supervisor] leg ${LEG}/${LEGS_TOTAL} finished with ${crashes} crash restart(s)"
exit 0
