import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverCs2ConfigDirectories, steamLibraryPaths, isSafeCs2ConfigDirectory } from '../src/steam-discovery.js';
import { saveObserverConfig } from '../src/gsi-save.js';

function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'anocore-steam-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}
function install(root) {
  const appdir = join(root, 'steamapps');
  const cfg = join(appdir, 'common', 'Counter-Strike Global Offensive', 'game', 'csgo', 'cfg');
  mkdirSync(cfg, { recursive: true });
  writeFileSync(join(appdir, 'appmanifest_730.acf'), '"AppState" { "appid" "730" }');
  return cfg;
}

test('extracts modern Steam library paths without evaluating VDF code', () => {
  const data = String.raw`"libraryfolders"
{
  "0" { "path" "C:\\Program Files (x86)\\Steam" "apps" { "730" "123" } }
  "1" { "path" "D:\\SteamLibrary" "apps" { "730" "222" } }
}
`;
  assert.deepEqual(steamLibraryPaths(data), ['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
  assert.deepEqual(steamLibraryPaths('not valid VDF'), []);
  assert.deepEqual(steamLibraryPaths('x'.repeat(300000)), []);
});

test('finds installed CS2 in a secondary Steam library and deduplicates results', t => {
  const root = fixture(t);
  const steam = join(root, 'Steam');
  const second = join(root, 'OtherLibrary');
  mkdirSync(join(steam, 'steamapps'), { recursive: true });
  const cfg = install(second);
  writeFileSync(join(steam, 'steamapps', 'libraryfolders.vdf'),
    '"libraryfolders" { "0" { "path" "' + steam + '" } "1" { "path" "' + second + '" } }');
  const found = discoverCs2ConfigDirectories({
    env: { SteamPath: steam },
    additionalSteamRoots: [steam],
  });
  assert.deepEqual(found, [cfg]);
  assert.equal(isSafeCs2ConfigDirectory(cfg), true);
});

test('rejects missing, misleading or symlinked CS2 installations', t => {
  const root = fixture(t);
  const bare = join(root, 'not-installed');
  mkdirSync(join(bare, 'steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo', 'cfg'), { recursive: true });
  assert.deepEqual(discoverCs2ConfigDirectories({ env: {}, additionalSteamRoots: [bare] }), []);
  const installed = join(root, 'installed');
  const cfg = install(installed);
  writeFileSync(join(installed, 'steamapps', 'appmanifest_730.acf'), '"appid" "123"');
  assert.equal(isSafeCs2ConfigDirectory(cfg), false);
  writeFileSync(join(installed, 'steamapps', 'appmanifest_730.acf'), '"appid" "730"');
  const linkRoot = join(root, 'symlink-library');
  symlinkSync(installed, linkRoot, process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(discoverCs2ConfigDirectories({ env: {}, additionalSteamRoots: [linkRoot] }), []);
});

test('explicit config export refuses overwrite and never changes existing secrets', t => {
  const root = fixture(t);
  const file = join(root, 'gamestate_integration_anocore.cfg');
  const config = '"gamestate_integration_anocore" { "auth" { "token" "one-time-key" } }';
  saveObserverConfig(file, config);
  assert.equal(readFileSync(file, 'utf8'), config);
  assert.throws(() => saveObserverConfig(file, '"new-key"'));
  assert.equal(readFileSync(file, 'utf8'), config);
  assert.equal(readFileSync(file, 'utf8').includes('new-key'), false);
  assert.throws(() => saveObserverConfig(join(root, 'other.cfg'), config));
});
