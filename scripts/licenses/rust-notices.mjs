/**
 * Prints licence notices for the Rust crates compiled into the OpenMLS
 * WebAssembly module (normal dependencies for wasm32), with each crate's
 * licence files. Run from wasm/mls (uses `cargo metadata`).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const meta = JSON.parse(
  execFileSync('cargo', ['metadata', '--format-version', '1', '--filter-platform', 'wasm32-unknown-unknown', '--locked'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }),
);
const byId = new Map(meta.packages.map((p) => [p.id, p]));
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const seen = new Set();
const stack = [meta.resolve.root];
while (stack.length) {
  const id = stack.pop();
  if (seen.has(id)) continue;
  seen.add(id);
  for (const d of nodes.get(id)?.deps ?? []) {
    if (d.dep_kinds.some((k) => k.kind === null)) stack.push(d.pkg);
  }
}
seen.delete(meta.resolve.root);
const pkgs = [...seen].map((id) => byId.get(id)).sort((a, b) => a.name.localeCompare(b.name));
let out = 'Third-party Rust crates compiled into OpenSocial (OpenMLS WebAssembly module)\n\n';
for (const p of pkgs) {
  out += `${'='.repeat(78)}\n${p.name} ${p.version}\nLicense: ${p.license ?? p.license_file ?? 'see files'}\n`;
  if (p.repository) out += `Source: ${p.repository}\n`;
  const dir = dirname(p.manifest_path);
  const files = readdirSync(dir).filter((f) => /^(LICEN[CS]E|COPYING|NOTICE)/i.test(f)).sort();
  for (const f of files) out += `\n--- ${f} ---\n${readFileSync(join(dir, f), 'utf8').trim()}\n`;
  if (files.length === 0) out += `(No licence file in the published crate; the standard text of ${p.license} is at the end.)\n`;
  if (/MPL/.test(p.license ?? '')) {
    out += `MPL-2.0: this crate is used unmodified. Its source code is available at ${p.repository ?? 'crates.io'} (crate ${p.name} ${p.version}).\n`;
  }
  out += '\n';
}
const texts = new URL('./texts/', import.meta.url).pathname;
for (const id of ['MIT', 'Apache-2.0', 'MPL-2.0']) {
  out += `${'='.repeat(78)}\nStandard licence text: ${id}\n\n${readFileSync(join(texts, `${id}.txt`), 'utf8').trim()}\n\n`;
}
process.stdout.write(out);
