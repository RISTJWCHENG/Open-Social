#!/usr/bin/env bash
# Builds OpenMLS (via this wrapper) to WebAssembly, writes the JS bindings to
# src/vendor/open-social-mls and collects third-party licence texts of the Rust
# dependencies. Needs Rust (wasm32-unknown-unknown) and wasm-bindgen-cli 0.2.104.
set -euo pipefail
cd "$(dirname "$0")"
cargo build --release --target wasm32-unknown-unknown --locked
OUT=../../src/vendor/open-social-mls
wasm-bindgen --target web --out-dir "$OUT" target/wasm32-unknown-unknown/release/open_social_mls.wasm
node ../../scripts/licenses/rust-notices.mjs > "$OUT/THIRD_PARTY_RUST.txt"
