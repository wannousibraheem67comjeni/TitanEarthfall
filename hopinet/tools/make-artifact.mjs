// Turns web/dist-single/index.html into a page for the Claude Artifact viewer (no <html>/<head>/<body> wrappers).
// usage: node tools/make-artifact.mjs <out.html>
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = fs.readFileSync(path.join(root, 'web/dist-single/index.html'), 'utf8');
const out = process.argv[2] || path.join(root, 'releases/hopinet-artifact.html');
const strip = (s) => s
  .replace(/<!doctype html>/i, '')
  .replace(/<\/?html[^>]*>/gi, '')
  .replace(/<\/?head>/gi, '')
  .replace(/<\/?body>/gi, '')
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<title>[^<]*<\/title>\s*/i, '');
const page = `<title>Hopinet</title>\n<style>:root{color-scheme:dark;--page:#08303f}html,body{background:var(--page);height:100%}</style>\n${strip(src)}`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log('artifact page', (page.length / 1024).toFixed(0), 'KB ->', out);
