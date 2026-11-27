#!/usr/bin/env bash
# Builds the identity canister wasm. Requires Rust with the wasm32-unknown-unknown target.
set -euo pipefail
cd "$(dirname "$0")"
cargo test --lib --locked candid_file -q
cargo build --release --target wasm32-unknown-unknown --locked
