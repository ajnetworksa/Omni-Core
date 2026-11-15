#!/usr/bin/env bash
# OmniCore updater helper — runs scripts/update.sh when the app asks for it (Settings → Update).
#
# The app and this helper share one folder, data/.update/:
#   request.json   written by the app: {"kind":"check"} or {"kind":"update"}
#   status.json    written here: {"state":"running|uptodate|available|updated|failed", ...}
#   last.log       the update script's output (shown in Settings)
#   updater.json   heartbeat every few seconds, so the app knows the helper is running
#
# It works on the real checkout on the host (mounted at /repo), as the owner of that folder,
# talking to the host's Docker. It never changes anything on its own: only on a request.
set -uo pipefail

REPO=/repo
[[ -f "$REPO/scripts/update.sh" ]] || { echo "updater: $REPO/scripts/update.sh not found (is the checkout mounted?)"; sleep 60; exit 1; }
STATE="$REPO/data/.update"
mkdir -p "$STATE" && chmod a+rwx "$STATE" 2>/dev/null || true
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Where compose runs this project on the host. Running compose from the same path (and project
# name) makes "./data", the build context etc. mean the same folders as on the host.
SELF="$(hostname)"
WD="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$SELF" 2>/dev/null || true)"
PROJECT="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$SELF" 2>/dev/null || true)"
if [[ -z "$WD" || "$WD" == "<no value>" ]]; then
  echo "updater: can't read my own compose labels — is /var/run/docker.sock mounted?"
  printf '{"state":"failed","kind":"start","finishedAt":"%s","error":"The helper cannot reach Docker (is /var/run/docker.sock mounted?)"}\n' "$(now)" > "$STATE/status.json"
  sleep 60; exit 1
fi
if [[ "$WD" != "$REPO" && ! -e "$WD" ]]; then mkdir -p "$(dirname "$WD")" && ln -s "$REPO" "$WD"; fi

# Run as whoever owns the checkout, so git keeps working for you afterwards and your SSH key /
# git credentials (home folder mounted read-only at /host-home) are used for the fetch.
OWNER_UID="$(stat -c %u "$REPO")"; OWNER_GID="$(stat -c %g "$REPO")"; SOCK_GID="$(stat -c %g /var/run/docker.sock)"
# ssh takes the home folder from /etc/passwd (not $HOME), so point the owner's entry at /host-home.
if grep -q "^[^:]*:[^:]*:$OWNER_UID:" /etc/passwd; then
  sed -i -E "s#^([^:]*:[^:]*:$OWNER_UID:[^:]*:[^:]*:)[^:]*#\1/host-home#" /etc/passwd
else
  echo "omni:x:$OWNER_UID:$OWNER_GID::/host-home:/bin/bash" >> /etc/passwd
fi
grep -q "^[^:]*:[^:]*:$OWNER_GID:" /etc/group || echo "omni:x:$OWNER_GID:" >> /etc/group
RUN=()
if [[ "$OWNER_UID" != 0 ]]; then
  RUN=(setpriv --reuid="$OWNER_UID" --regid="$OWNER_GID" --groups="$OWNER_GID,$SOCK_GID" --)
else
  git config --global --add safe.directory '*'
fi
export HOME=/host-home COMPOSE_PROJECT_NAME="$PROJECT" OMNICORE_URL="${OMNICORE_URL:-http://omnicore-app:3000}" OMNICORE_DIR="$WD"
export GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -o BatchMode=yes"
echo "updater: ready — project '$PROJECT' at $WD, running as uid $OWNER_UID"

json_esc() { sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r'; }

# Heartbeat in the background, so the app knows the helper is alive even during a long build.
( while :; do
    printf '{"at":"%s","project":"%s","dir":"%s"}\n' "$(now)" "$PROJECT" "$WD" > "$STATE/updater.json.tmp" && mv -f "$STATE/updater.json.tmp" "$STATE/updater.json"
    sleep 5
  done ) &
HEARTBEAT=$!

while :; do
  if [[ -f "$STATE/request.json" ]]; then
    kind="$(sed -n 's/.*"kind" *: *"\([a-z]*\)".*/\1/p' "$STATE/request.json")"
    rm -f "$STATE/request.json"
    [[ "$kind" == check || "$kind" == update ]] || kind=check
    started="$(now)"
    printf '{"state":"running","kind":"%s","startedAt":"%s"}\n' "$kind" "$started" > "$STATE/status.json"
    args=(--yes); [[ "$kind" == check ]] && args=(--check)
    ( cd "$WD" && "${RUN[@]}" env OMNICORE_DIR="$WD" bash scripts/update.sh "${args[@]}" ) > "$STATE/last.log" 2>&1 < /dev/null
    code=$?
    case "$kind:$code" in
      check:10) state=available ;;
      check:0) state=uptodate ;;
      update:0) if grep -q "already up to date\|nothing to update" "$STATE/last.log"; then state=uptodate; else state=updated; fi ;;
      *) state=failed ;;
    esac
    err=""; [[ "$state" == failed ]] && err="$(sed 's/\x1b\[[0-9;]*m//g' "$STATE/last.log" | grep -E '^(xx|!!) |fatal:|error TS|ERROR' | sed -E 's/^(xx|!!) //' | tail -2 | tr '\n' ' ' | json_esc)"
    printf '{"state":"%s","kind":"%s","startedAt":"%s","finishedAt":"%s","code":%d,"error":"%s"}\n' "$state" "$kind" "$started" "$(now)" "$code" "$err" > "$STATE/status.json"
    chmod a+rw "$STATE"/*.json "$STATE/last.log" 2>/dev/null || true
    kill "$HEARTBEAT" 2>/dev/null
    exec bash "$0"   # pick up a new version of this script after an update
  fi
  sleep 3
done
