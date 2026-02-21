/**
 * E2E auth: storage state path, secret bootstrap, option types.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const projectRoot = join(process.cwd());

/** Path where cookies + localStorage are loaded from (no write-back on test end). When file is missing and E2E_STORAGE_STATE_BASE64 is set, the fixture creates it from the secret. */
export const E2E_STORAGE_STATE_PATH = join(projectRoot, 'e2e', '.auth', 'storageState.json');

const E2E_STORAGE_STATE_BASE64_ENV = 'E2E_STORAGE_STATE_BASE64';

/** If storage state file is missing and E2E_STORAGE_STATE_BASE64 is set, decode and write the file. */
export function ensureStorageStateFromSecret(): void {
  if (existsSync(E2E_STORAGE_STATE_PATH)) return;
  const base64 = process.env[E2E_STORAGE_STATE_BASE64_ENV];
  if (!base64 || typeof base64 !== 'string') return;
  mkdirSync(dirname(E2E_STORAGE_STATE_PATH), { recursive: true });
  const decoded = Buffer.from(base64, 'base64').toString('utf8');
  writeFileSync(E2E_STORAGE_STATE_PATH, decoded, 'utf8');
}

/** true = use E2E_STORAGE_STATE_PATH, false/undefined = isolated context. */
export type AuthStateOption = true | false | undefined;

/** true = write storage state to file on context close, false/undefined = no write-back. */
export type StoreAuthStateOption = true | false | undefined;
