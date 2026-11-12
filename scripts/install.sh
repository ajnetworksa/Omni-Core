#!/usr/bin/env bash
# Optional shortcut for the first start. It does what the README says:
#   cp .env.example .env  (only if .env doesn't exist yet)  →  docker compose up -d --build
# then waits until the app answers and tells you where the web password is.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31mxx\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "Docker is required: curl -fsSL https://get.docker.com | sudo sh"
docker compose version >/dev/null 2>&1 || die "the Docker Compose plugin is required (docker compose version)"

if [[ ! -f .env ]]; then
  cp .env.example .env && chmod 600 .env
  say "created .env from .env.example — edit it any time, then run: docker compose up -d"
fi

say "starting (the first build takes a few minutes)"
GIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)" BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" docker compose up -d --build

port="$(grep -E '^PORT=' .env | cut -d= -f2 || true)"; port="${port:-3000}"
for _ in $(seq 90); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
    say "running at http://127.0.0.1:${port}"
    if grep -qE '^API_TOKEN=.+' .env; then echo "    password: API_TOKEN in .env"; else echo "    password: cat data/api-token"; fi
    exit 0
  fi
  sleep 2
done
die "the app didn't answer — check: docker compose logs omnicore-app"
