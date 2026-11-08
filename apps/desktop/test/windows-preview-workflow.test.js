import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../../.github/workflows/windows-desktop.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../REAL-OBSERVER-ACCEPTANCE.md', import.meta.url), 'utf8');

test('portable Windows preview runs for merged main updates and PR changes', () => {
  const triggers = workflow.split('\npermissions:')[0];
  assert.match(triggers, /\non:\n/);
  assert.match(triggers, /  workflow_dispatch:\n/);
  assert.match(triggers, /  push:\n    branches: \[main\]\n    paths:\n/);
  assert.match(triggers, /  pull_request:\n    paths:\n/);
  const pushPaths = triggers.split('  push:\n')[1].split('  pull_request:\n')[0];
  for (const path of ["'apps/desktop/**'", "'adapters/cs2/**'",
    "'services/engine/**'", "'apps/overlay/**'",
    "'package.json'", "'.github/workflows/windows-desktop.yml'"]) {
    assert.ok(pushPaths.includes(path), 'main push misses ' + path);
  }
});

test('main preview artifact cannot upload before checks, tests, packaged smoke and hash', () => {
  const steps = [
    'Run checks', 'Run tests', 'Build portable Windows x64 preview',
    'Smoke test packaged Electron desktop startup and shutdown',
    'Create SHA-256 checksums', 'actions/upload-artifact@v4',
  ];
  let previous = -1;
  for (const step of steps) {
    const at = workflow.indexOf(step);
    assert.ok(at > previous, 'incorrect build verification step order: ' + step);
    previous = at;
  }
  assert.match(workflow, /throw 'No portable Windows EXE found/);
  assert.match(workflow, /Get-FileHash.*-Algorithm SHA256/);
  assert.match(workflow, /dist\/SHA256SUMS\.txt/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /retention-days: 7/);
});

test('operator instructions require main SHA and verification before live acceptance', () => {
  assert.match(readme, /main-branch run/);
  assert.match(readme, /Get-FileHash/);
  assert.match(guide, /main-branch run/);
  assert.match(guide, /SHA-256/);
  assert.match(guide, /NOT YET EXECUTED/);
});
