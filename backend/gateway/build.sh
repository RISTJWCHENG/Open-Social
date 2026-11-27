#!/usr/bin/env bash
# Builds the gateway wasm and refreshes its Candid file.
set -euo pipefail
cd "$(dirname "$0")"
cargo test --lib --locked candid_file -q
cargo build --release --target wasm32-unknown-unknown --locked
