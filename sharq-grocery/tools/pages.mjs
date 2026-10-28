// Copies the single-file build to ../docs/sharq for GitHub Pages, next to Rizq Street
// (Settings → Pages → Deploy from a branch → /docs).
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '..', 'docs', 'sharq');
mkdirSync(out, { recursive: true });
copyFileSync(join(root, 'dist-single', 'index.html'), join(out, 'index.html'));
console.log('docs/sharq/index.html ready for GitHub Pages');
