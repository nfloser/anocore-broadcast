import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createObserverCredentialStore } from '../src/credentials.js';
import { startDesktopLive } from '../src/live-service.js';
import { createDemoFrame } from '../../overlay/src/demo-fixture.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'anocore-keys-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'observer-credential.json');
}
const encrypted = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from('sealed:' + value, 'utf8'),
  decryptString: buffer => {
    const value = buffer.toString('utf8');
    if (!value.startsWith('sealed:')) throw new Error('Decryption failed');
    return value.slice('sealed:'.length);
  },
};

test('observer key persists only as encrypted ciphertext and survives restarts', t => {
  const path = fixture(t);
  const first = createObserverCredentialStore({ filePath: path, encryption: encrypted });
  const original = first.getOrCreate();
  assert.match(original, /^[a-f0-9]{64}$/);
  const content = readFileSync(path, 'utf8');
  assert.ok(!content.includes(original));
  assert.equal(JSON.parse(content).schemaVersion, 1);
  assert.equal(JSON.parse(content).provider, 'electron-safe-storage');
  const second = createObserverCredentialStore({ filePath: path, encryption: encrypted });
  assert.equal(second.getOrCreate(), original);
  assert.equal(first.getOrCreate(), original);
});

test('observer key storage fails closed without strong OS encryption', t => {
  const path = fixture(t);
  const insecure = createObserverCredentialStore({
    filePath: path, encryption: {
      isEncryptionAvailable: () => false,
      encryptString: () => { throw new Error('Must not encrypt'); },
      decryptString: () => { throw new Error('Must not decrypt'); },
    },
  });
  assert.throws(() => insecure.getOrCreate(), /secure storage unavailable/i);
  assert.throws(() => readFileSync(path), /ENOENT/);
});

test('damaged or unsupported stored credentials never rotate silently', t => {
  const path = fixture(t);
  const store = createObserverCredentialStore({ filePath: path, encryption: encrypted });
  const original = store.getOrCreate();
  const raw = readFileSync(path, 'utf8');
  for (const data of [
    '{', '{"schemaVersion":2,"provider":"electron-safe-storage","ciphertext":"xx"}',
    '{"schemaVersion":1,"provider":"electron-safe-storage","ciphertext":"!!"}',
    '{"schemaVersion":1,"provider":"electron-safe-storage","ciphertext":"Y29ycnVwdA=="}',
  ]) {
    writeFileSync(path, data);
    assert.throws(() => store.getOrCreate(), /saved observer key/i);
    assert.equal(readFileSync(path, 'utf8'), data);
  }
  writeFileSync(path, raw);
  assert.equal(store.getOrCreate(), original);
});

test('observer key reset requires explicit action and cannot delete symlinks', t => {
  const path = fixture(t);
  const store = createObserverCredentialStore({ filePath: path, encryption: encrypted });
  const original = store.getOrCreate();
  store.reset();
  const replacement = store.getOrCreate();
  assert.notEqual(replacement, original);
  const dir = join(path, '..');
  const target = join(dir, 'untouched.txt');
  writeFileSync(target, 'do not alter');
  const link = join(dir, 'linked-key.json');
  symlinkSync(target, link);
  const linkedStore = createObserverCredentialStore({ filePath: link, encryption: encrypted });
  assert.throws(() => linkedStore.getOrCreate(), /saved observer key/i);
  assert.throws(() => linkedStore.reset(), /saved observer key/i);
  assert.equal(readFileSync(target, 'utf8'), 'do not alter');
});

test('reused key authenticates a fresh live observer process after previous shutdown', async t => {
  const filePath = fixture(t);
  const store = createObserverCredentialStore({ filePath, encryption: encrypted });
  const token = store.getOrCreate();
  const first = await startDesktopLive({ receiverPort: 0, overlayPort: 0, token });
  await first.close();
  const live = await startDesktopLive({
    receiverPort: 0, overlayPort: 0,
    token: createObserverCredentialStore({ filePath, encryption: encrypted }).getOrCreate(),
  });
  try {
    assert.ok(live.getGsiConfig().includes(token));
    const response = await fetch(live.gsiUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createDemoFrame(0, token)),
    });
    assert.equal(response.status, 202);
    const state = await (await fetch(live.hudUrl + 'api/state')).json();
    assert.equal(state.status, 'live');
    assert.equal(state.demo, undefined);
    assert.ok(!JSON.stringify(state).includes(token));
  } finally {
    await live.close();
  }
});
