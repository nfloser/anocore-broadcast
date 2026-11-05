import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';

export const CS2_GSI_FILENAME = 'gamestate_integration_anocore.cfg';

/** Export is always a deliberate native-save action; never overwrite prior secrets. */
export function saveObserverConfig(filePath, config) {
  if (typeof filePath !== 'string' || !filePath ||
      basename(filePath).toLowerCase() !== CS2_GSI_FILENAME ||
      typeof config !== 'string' || !config.startsWith('"gamestate_integration_anocore"')) {
    throw new TypeError('Invalid GSI configuration export');
  }
  writeFileSync(filePath, config, {
    encoding: 'utf8', flag: 'wx', mode: 0o600,
  });
}
