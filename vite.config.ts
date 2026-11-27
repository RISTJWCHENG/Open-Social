/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';

const git = (args: string): string => {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

/*
 * App version: package.json holds the base version and a matching git tag
 * (v1.0.0) marks the commit it starts from. Each later commit adds one to the
 * patch number, so every update gets a new version without editing anything.
 * The release date is the date of the commit being built. See docs/VERSIONING.md.
 */
const base: string = JSON.parse(readFileSync('package.json', 'utf8')).version;
const [major, minor, patch] = base.split('.').map(Number);
const since = git(`rev-list --count v${base}..HEAD`);
const version = since === '' ? base : `${major}.${minor}.${patch + Number(since)}`;
const released = git('log -1 --format=%cI') || new Date().toISOString();
const commit = git('rev-parse --short=12 HEAD') || 'unknown';

// Static build output is uploaded to an ICP asset canister (see dfx.json).
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_COMMIT__: JSON.stringify(commit),
    __APP_VERSION__: JSON.stringify(version),
    __APP_RELEASED__: JSON.stringify(released),
  },
  // The Sia Storage SDK loads its WebAssembly relative to its own module URL.
  optimizeDeps: { exclude: ['@siafoundation/sia-storage'] },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Never inline assets as data: URIs; the CSP allows fonts and scripts from 'self' only.
    assetsInlineLimit: 0,
    target: 'es2022',
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/main.tsx'],
    },
  },
});
