// Copies the single-file build to ../docs for GitHub Pages (Settings → Pages →
// Deploy from a branch → /docs). On a real web page the browser can ask for the
// microphone, which the claude.ai viewer does not allow.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, '..', 'docs');
mkdirSync(docs, { recursive: true });
copyFileSync(join(root, 'dist-single', 'index.html'), join(docs, 'index.html'));
writeFileSync(join(docs, '.nojekyll'), '');
console.log('docs/index.html ready for GitHub Pages');
