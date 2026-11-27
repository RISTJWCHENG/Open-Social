/**
 * Writes dist/third-party-licenses.txt: licence notices for every third-party
 * component shipped in the web app (npm production dependencies and the Rust
 * crates compiled into the OpenMLS WebAssembly module). Runs after vite build.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
);
const pkgs = new Map();
const walk = (deps) => {
  for (const [name, info] of Object.entries(deps ?? {})) {
    const key = `${name}@${info.version}`;
    if (!pkgs.has(key)) {
      pkgs.set(key, { name, version: info.version });
      walk(info.dependencies);
    }
  }
};
walk(tree.dependencies);

let out = 'OpenSocial: third-party software notices\n\nOpenSocial is proprietary software. It includes the third-party components\nlisted below, each used under its own licence.\n\n';
out += `${'#'.repeat(78)}\nPart 1: JavaScript packages\n${'#'.repeat(78)}\n\n`;
for (const p of [...pkgs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  const dir = join(root, 'node_modules', p.name);
  let license = 'see package';
  try {
    const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    license = typeof pj.license === 'string' ? pj.license : pj.license?.type ?? license;
    if (license === 'see package' && existsSync(join(dir, 'README.md'))) {
      // Some packages state the licence only in the README ("## License" followed by the SPDX id).
      const m = readFileSync(join(dir, 'README.md'), 'utf8').match(/^##\s*Licen[cs]e\s*\n+\s*([A-Za-z0-9.\- ]+)\s*$/m);
      if (m) license = `${m[1].trim()} (stated in README; standard text at the end)`;
    }
  } catch {
    continue;
  }
  out += `${'='.repeat(78)}\n${p.name} ${p.version}\nLicense: ${license}\n`;
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^(LICEN[CS]E|COPYING|NOTICE)/i.test(f)).sort() : [];
  for (const f of files) out += `\n${readFileSync(join(dir, f), 'utf8').trim()}\n`;
  out += '\n';
}
const rust = join(root, 'src/vendor/open-social-mls/THIRD_PARTY_RUST.txt');
out += `${'#'.repeat(78)}\nPart 2: Rust crates (OpenMLS WebAssembly module)\n${'#'.repeat(78)}\n\n`;
out += readFileSync(rust, 'utf8');
out += `${'#'.repeat(78)}\nPart 3: Data and fonts\n${'#'.repeat(78)}\n\n`;
out += `${'='.repeat(78)}\nEmoji names, keywords and categories (assets/emojiData-*.js)\nGenerated from emojibase-data (https://emojibase.dev). License: MIT\n`;
out += `\n${readFileSync(join(root, 'node_modules', 'emojibase-data', 'LICENSE'), 'utf8').trim()}\n\n`;
out += `${'='.repeat(78)}\nTwemojiCountryFlags.woff2 (flag emoji on systems without them)\n`;
out += 'Flag graphics from Twemoji, Copyright 2019 Twitter, Inc and other contributors.\n';
out += 'License: CC-BY 4.0, https://creativecommons.org/licenses/by/4.0/\n';
out += 'Font file from the country-flag-emoji-polyfill project (MIT, Copyright (c) Talkyard).\n\n';
out += `${'='.repeat(78)}\nStandard licence text: MIT (for packages above whose MIT text is not bundled)\n\n`;
out += readFileSync(join(root, 'scripts/licenses/texts/MIT.txt'), 'utf8');
writeFileSync(join(root, 'dist', 'third-party-licenses.txt'), out);
console.log(`notices: dist/third-party-licenses.txt (${pkgs.size} npm packages)`);
