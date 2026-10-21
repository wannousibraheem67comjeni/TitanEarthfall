// Private QA build: bundles the game into <outdir> (default /tmp/hopinet-qa/dist) WITHOUT touching web/dist,
// so several reviewers can build in parallel. Usage: node tools/qa-build.mjs <outdir>
import * as esbuild from '../web/node_modules/esbuild/lib/main.js';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.resolve(process.argv[2] || '/tmp/hopinet-qa/dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
await esbuild.build({ entryPoints: [path.join(root, 'web/src/main.js')], bundle: true, format: 'iife', target: ['chrome80'], outfile: path.join(out, 'game.js'), logLevel: 'warning', nodePaths: [path.join(root, 'web/node_modules')] });
for (const f of ['index.html', 'style.css']) fs.copyFileSync(path.join(root, 'web/src', f), path.join(out, f));
const fs_ = path.join(root, 'web/node_modules/@fontsource-variable/baloo-bhaijaan-2/files');
fs.copyFileSync(path.join(fs_, 'baloo-bhaijaan-2-arabic-wght-normal.woff2'), path.join(out, 'fonts/baloo-arabic.woff2'));
fs.copyFileSync(path.join(fs_, 'baloo-bhaijaan-2-latin-wght-normal.woff2'), path.join(out, 'fonts/baloo-latin.woff2'));
fs.copyFileSync(path.join(root, 'web/public/icon.svg'), path.join(out, 'icon.svg'));
console.log('qa build ok ->', out);
