/**
 * Create git tag v{VERSION} from package.json and push to origin.
 * Run after squash-merge of release PR so the tag points at the merge commit.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const v = pkg.version;
const tag = `v${v}`;

execSync(`git tag ${tag} && git push origin ${tag}`, { stdio: 'inherit' });
