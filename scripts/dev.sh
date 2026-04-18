#!/usr/bin/env bash
# Dev entrypoint — boots all workspaces in parallel.
#
# At Phase 0 there is nothing to boot; this is a placeholder that wires up
# once packages define their own `dev` scripts (Phase 4+ for server, Phase 7
# for web). Right now it lists the workspaces so contributors see the shape.

set -euo pipefail

echo "BrandFactory — workspaces:"
pnpm -r exec node -e "console.log('  ' + process.env.npm_package_name)"

echo
echo "No dev targets defined yet. Add 'dev' scripts to individual packages"
echo "as you implement later phases (server in Phase 4, web in Phase 7)."
