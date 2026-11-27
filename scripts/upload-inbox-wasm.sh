#!/usr/bin/env bash
# Builds the inbox shard wasm and gives it to the orchestrator, which uses it
# for new shards and for upgrades (then run `upgrade_shards`, in waves).
# Usage: scripts/upload-inbox-wasm.sh [network]   (default: ic)
set -euo pipefail
cd "$(dirname "$0")/.."
network="${1:-ic}"
bash backend/inbox/build.sh
tmp="$(mktemp -d)"
gzip -9 -c backend/inbox/target/wasm32-unknown-unknown/release/open_social_inbox.wasm > "$tmp/inbox.wasm.gz"
python3 - "$tmp/inbox.wasm.gz" "$tmp/arg.txt" <<'PY'
import sys
data = open(sys.argv[1], "rb").read()
open(sys.argv[2], "w").write('(blob "' + "".join("\\%02x" % b for b in data) + '")')
PY
dfx canister --network "$network" call open-social-app-orchestrator set_inbox_wasm --argument-file "$tmp/arg.txt"
rm -rf "$tmp"
