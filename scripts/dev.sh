#!/usr/bin/env bash
# Dev entrypoint — boots the Hono server and Vite frontend in parallel.
#
# The server serves the API + realtime WS on :3001. Vite boots on :5173 with
# a proxy (`/api` → :3001, `/rt` → :3001) so the browser sees a single origin
# and no CORS setup is needed in dev.
#
# Assumes Postgres is already running. Start it via
# `docker compose -f docker/compose.yaml up -d` and apply migrations with
# `pnpm -F @brandfactory/db db:migrate` before the first boot.

set -euo pipefail

cd "$(dirname "$0")/.."

server_pid=
web_pid=

cleanup() {
  trap - INT TERM EXIT
  [[ -n "${server_pid}" ]] && kill "${server_pid}" 2>/dev/null || true
  [[ -n "${web_pid}" ]] && kill "${web_pid}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "→ server: http://localhost:3001"
pnpm -F @brandfactory/server dev &
server_pid=$!

echo "→ web:    http://localhost:5173"
pnpm -F @brandfactory/web dev &
web_pid=$!

# Exit as soon as either process dies — matches "Ctrl-C kills everything".
# Without `-n`, a crashed server would leave Vite running and produce
# misleading 500s in the browser. `cleanup` above then tears down the peer.
wait -n
