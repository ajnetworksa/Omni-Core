#!/usr/bin/env bash
# OmniCore updater — run on the server, from the checkout (or set OMNICORE_DIR).
#
#   scripts/update.sh            show what's new, back up, update, verify; roll back on failure
#   scripts/update.sh --check    only say whether an update is available (exit 10 = yes)
#   scripts/update.sh --yes      don't ask
#   scripts/update.sh --ref v0.6.0   go to a tag/branch/commit instead of the tracked branch
#   scripts/update.sh --rollback     go back to the version before the last update
#
# How it updates depends on how you deployed (auto-detected, or --mode):
#   docker  docker compose, building from this checkout          (git pull → build → up)
#   image   docker compose with OMNICORE_IMAGE=ghcr.io/…:tag      (compose pull → up)
#   node    plain Node + systemd / pm2 / OMNICORE_RESTART_CMD     (git pull → npm ci → build → restart)
#
# Every update: database snapshot first (data/backups/), health check after (/health must answer
# with the new commit), automatic rollback (old code + the pre-update database if migrations ran).
set -Eeuo pipefail

DIR="${OMNICORE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$DIR"
STATE_DIR="$DIR/data/.update"
mkdir -p "$STATE_DIR"

CHECK=0 YES=0 REF="" MODE="${OMNICORE_MODE:-}" ROLLBACK=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK=1 ;;
    --yes|-y) YES=1 ;;
    --ref) REF="${2:?--ref needs a value}"; shift ;;
    --mode) MODE="${2:?--mode needs docker|image|node}"; shift ;;
    --rollback) ROLLBACK=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31mxx\033[0m %s\n' "$*" >&2; exit 1; }

# .env values the script needs (without exporting secrets into child processes).
envval() { [[ -f .env ]] && grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
PORT="${PORT:-$(envval PORT)}"; PORT="${PORT:-3000}"
URL="${OMNICORE_URL:-http://127.0.0.1:${PORT}}"
IMAGE="${OMNICORE_IMAGE:-$(envval OMNICORE_IMAGE)}"
SERVICE="${OMNICORE_SERVICE:-omnicore}"
HEALTH_TIMEOUT="${OMNICORE_HEALTH_TIMEOUT:-120}"

if [[ -z "$MODE" ]]; then
  if [[ -n "$IMAGE" ]]; then MODE=image
  elif command -v docker >/dev/null && docker compose ps --status running -q omnicore-app 2>/dev/null | grep -q .; then MODE=docker
  elif [[ -f docker-compose.yml ]] && command -v docker >/dev/null && [[ ! -d node_modules ]]; then MODE=docker
  else MODE=node; fi
fi
[[ "$MODE" =~ ^(docker|image|node)$ ]] || die "--mode must be docker, image or node"

compose() { docker compose "$@"; }

health() { # prints "version sha" when healthy (plain sed: the host may not have Node)
  local body v h
  body="$(curl -fsS --max-time 5 "$URL/health" 2>/dev/null)" || return 1
  [[ "$body" == *'"ok":true'* ]] || return 1
  v="$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' <<<"$body")"
  h="$(sed -n 's/.*"sha":"\([0-9a-f]*\)".*/\1/p' <<<"$body")"
  echo "${v:-?} ${h}"
}

wait_healthy() { # $1 = expected sha prefix (optional)
  local want="${1:-}" end=$((SECONDS + HEALTH_TIMEOUT)) got=""
  while (( SECONDS < end )); do
    if got="$(health)"; then
      if [[ -z "$want" || "${got#* }" == "${want:0:12}"* ]]; then echo "$got"; return 0; fi
    fi
    sleep 2
  done
  warn "no healthy answer from $URL/health within ${HEALTH_TIMEOUT}s (last: ${got:-none})"
  return 1
}

backup_db() { # $1 = label; prints the backup path
  local out
  case "$MODE" in
    docker|image) out="$(compose exec -T omnicore-app node apps/server/dist/backup.js --label "$1" | tail -1)" || return 1
                  out="$DIR/data/${out#/data/}" ;;
    node)         out="$(node apps/server/dist/backup.js --label "$1" | tail -1)" || return 1 ;;
  esac
  echo "$out"
}

stop_app() {
  case "$MODE" in
    docker|image) compose stop omnicore-app >/dev/null ;;
    node) if [[ -n "${OMNICORE_STOP_CMD:-}" ]]; then bash -c "$OMNICORE_STOP_CMD"
          elif systemctl list-units --all "$SERVICE.service" 2>/dev/null | grep -q "$SERVICE"; then sudo systemctl stop "$SERVICE"
          elif command -v pm2 >/dev/null; then pm2 stop "$SERVICE" >/dev/null; fi ;;
  esac
}

restore_db() { # $1 = backup file on the host
  [[ -f "$1" ]] || { warn "backup $1 not found; database left as is"; return 1; }
  say "restoring database from $(basename "$1")"
  stop_app || true
  case "$MODE" in
    docker|image) compose run --rm --no-deps -T omnicore-app node apps/server/dist/backup.js --restore "/data/${1#"$DIR/data/"}" ;;
    node) node apps/server/dist/backup.js --restore "$1" ;;
  esac
}

STARTED=0   # set once new code has been started (only then can migrations have run)
deploy() { # build/start what's checked out (or pulled)
  case "$MODE" in
    docker)
      export GIT_SHA BUILT_AT
      GIT_SHA="$(git rev-parse HEAD)"; BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      compose build omnicore-app
      STARTED=1
      compose up -d omnicore-app ;;
    image)
      compose pull omnicore-app
      compose up -d --no-build omnicore-app ;;
    node)
      npm ci --no-audit --no-fund
      npm run build
      STARTED=1
      if [[ -n "${OMNICORE_RESTART_CMD:-}" ]]; then bash -c "$OMNICORE_RESTART_CMD"
      elif systemctl list-units --all "$SERVICE.service" 2>/dev/null | grep -q "$SERVICE"; then sudo systemctl restart "$SERVICE"
      elif command -v pm2 >/dev/null && pm2 describe "$SERVICE" >/dev/null 2>&1; then pm2 restart "$SERVICE"
      else die "don't know how to restart: set OMNICORE_RESTART_CMD, or run it as the systemd unit '$SERVICE'"; fi ;;
  esac
}

# ---------------------------------------------------------------- image mode
if [[ "$MODE" == image ]]; then
  [[ -n "$IMAGE" ]] || die "image mode needs OMNICORE_IMAGE in .env"
  old_id="$(docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || true)"
  if (( ROLLBACK )); then
    prev="$(cat "$STATE_DIR/prev-image" 2>/dev/null)" || die "nothing to roll back to"
    say "rolling back to image ${prev:7:12}"
    docker tag "$prev" "$IMAGE"; compose up -d --no-build omnicore-app; wait_healthy; exit
  fi
  say "checking $IMAGE"
  compose pull -q omnicore-app
  new_id="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
  if [[ "$new_id" == "$old_id" ]]; then say "already up to date ($(health || echo 'not running'))"; exit 0; fi
  (( CHECK )) && { say "a newer image is available"; exit 10; }
  if (( ! YES )); then read -r -p "Update to the new image? [y/N] " a || a=""; [[ "$a" =~ ^[Yy] ]] || exit 0; fi
  bk="$(backup_db pre-update)" || die "backup failed — nothing changed"
  say "database backed up: $(basename "$bk")"
  [[ -n "$old_id" ]] && echo "$old_id" > "$STATE_DIR/prev-image"
  compose up -d --no-build omnicore-app
  if got="$(wait_healthy)"; then say "updated: running $got"; exit 0; fi
  warn "new image is unhealthy — rolling back"
  [[ -n "$old_id" ]] || die "no previous image to roll back to"
  restore_db "$bk" || true
  docker tag "$old_id" "$IMAGE"; compose up -d --no-build omnicore-app
  wait_healthy >/dev/null && die "rolled back to the previous image; the database is as it was before the update" || die "rollback did not come up healthy — check: docker compose logs omnicore-app"
fi

# ---------------------------------------------------------------- git modes
command -v git >/dev/null || die "git is required"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$DIR is not a git checkout (clone it from GitHub, or use image mode)"
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || die "local changes to tracked files — commit or stash them first:
$(git status --short --untracked-files=no)"

old="$(git rev-parse HEAD)"
branch="$(git symbolic-ref -q --short HEAD || true)"

if (( ROLLBACK )); then
  prev="$(cat "$STATE_DIR/prev-commit" 2>/dev/null)" || die "nothing to roll back to"
  bk="$(cat "$STATE_DIR/prev-backup" 2>/dev/null || true)"
  say "rolling back $(git rev-parse --short HEAD) → ${prev:0:7}"
  # Stay on the branch (just pointed back), so a later plain update moves forward again.
  if [[ -n "$branch" ]]; then git reset -q --hard "$prev"; else git checkout -q --detach "$prev"; fi
  if [[ -n "$bk" ]] && ! git diff --quiet "$prev" "$old" -- packages/core/migrations; then restore_db "$bk"; fi
  deploy; wait_healthy "$prev" && say "rolled back to ${prev:0:7}"; exit
fi

say "fetching from $(git remote get-url origin 2>/dev/null || echo origin)"
git fetch -q --tags --force --prune origin || die "git fetch failed (network, or the remote is unreachable)"
if [[ -n "$REF" ]]; then
  target="$(git rev-parse -q --verify "origin/$REF^{commit}" 2>/dev/null || git rev-parse -q --verify "$REF^{commit}")" || die "unknown ref: $REF"
else
  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)" || die "this branch tracks nothing; use --ref <branch|tag>"
  target="$(git rev-parse "$upstream")"
fi

if [[ "$target" == "$old" ]]; then say "already up to date at $(git rev-parse --short HEAD) ($(git describe --tags --always 2>/dev/null))"; exit 0; fi
if git merge-base --is-ancestor "$target" "$old"; then say "you're ahead of ${REF:-$upstream} — nothing to update"; exit 0; fi

echo; say "changes $(git rev-parse --short "$old") → $(git rev-parse --short "$target"):"
git --no-pager log --oneline --no-decorate -n 30 "$old..$target" | sed 's/^/    /'
migrations="$(git diff --name-only "$old" "$target" -- packages/core/migrations)"
[[ -n "$migrations" ]] && { say "database migrations included (applied automatically on start):"; echo "$migrations" | sed 's/^/    /'; }
echo
(( CHECK )) && exit 10
if (( ! YES )); then read -r -p "Update now? [y/N] " a || a=""; [[ "$a" =~ ^[Yy] ]] || exit 0; fi

bk=""
if health >/dev/null; then
  bk="$(backup_db "pre-update-${old:0:7}")" || die "backup failed — nothing changed"
  say "database backed up: $(basename "$bk")"
else
  warn "the app isn't running, so there's no live database to snapshot; continuing"
fi
echo "$old" > "$STATE_DIR/prev-commit"
echo "$bk" > "$STATE_DIR/prev-backup"

say "checking out $(git rev-parse --short "$target")"
if [[ -z "$REF" ]] && git merge -q --ff-only "$target" 2>/dev/null; then :; else git checkout -q --detach "$target"; fi

rollback() {
  trap - ERR
  set +e
  warn "update failed — rolling back to ${old:0:7}"
  if [[ -n "$branch" ]]; then git checkout -q "$branch" && git reset -q --hard "$old"; else git checkout -q --detach "$old"; fi
  local restored=0
  if [[ -n "$migrations" && -n "$bk" && "$STARTED" == 1 ]]; then
    if restore_db "$bk"; then restored=1; else warn "database restore failed; backup is at $bk"; fi
  fi
  if deploy && wait_healthy "$old" >/dev/null; then
    die "rolled back: running ${old:0:7} again$( (( restored )) && echo ", database restored from before the update")"
  fi
  die "rollback did not come up healthy — see the logs; your pre-update backup is $bk"
}
trap rollback ERR
deploy
got="$(wait_healthy "$target")" || rollback
trap - ERR
say "updated: running $got"
git --no-pager log -1 --format='    %h %s (%cr)'
[[ -n "$REF" ]] && say "now on ${REF} (detached). To follow your branch again later: git checkout ${branch:-main} && scripts/update.sh"
exit 0
