// Builds the web game into dist/ (multi-file) and dist-single/index.html (everything inlined).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(root, 'dist');
const single = path.join(root, 'dist-single');
const watch = process.argv.includes('--watch');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f), d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

const options = {
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome80', 'safari14', 'firefox90'],
  outfile: path.join(dist, 'game.js'),
  legalComments: 'eof',
  logLevel: 'info',
};

function writeStatic() {
  copyDir(path.join(root, 'public'), dist);
  fs.copyFileSync(path.join(root, 'src/index.html'), path.join(dist, 'index.html'));
  fs.copyFileSync(path.join(root, 'src/style.css'), path.join(dist, 'style.css'));
}

function writeSingle() {
  fs.rmSync(single, { recursive: true, force: true });
  fs.mkdirSync(single, { recursive: true });
  let css = fs.readFileSync(path.join(dist, 'style.css'), 'utf8');
  css = css.replace(/url\(fonts\/([^)]+)\)/g, (_, f) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(dist, 'fonts', f)).toString('base64')})`);
  const js = fs.readFileSync(path.join(dist, 'game.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  const icon = fs.readFileSync(path.join(dist, 'icon.svg'), 'utf8');
  let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>${css}</style>`);
  html = html.replace('<link rel="icon" href="icon.svg">', () => `<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}">`);
  html = html.replace('<script src="game.js"></script>', () => `<script>${js}</script>`);
  fs.writeFileSync(path.join(single, 'index.html'), html);
  fs.writeFileSync(path.join(single, 'README.txt'), [
    'EBOT Gold Chase - offline web build / ايبوت: مطاردة الذهب - نسخة ويب أوفلاين',
    '',
    'Open index.html with a double-click (Chrome, Edge, Firefox, Safari). No internet, server or database needed.',
    'افتح الملف index.html بنقرة مزدوجة. لا يحتاج إنترنت ولا خادم ولا قاعدة بيانات.',
    '',
    'Progress is saved in this browser only. The store in the web build is a demo (no payment).',
    'يُحفظ التقدم في هذا المتصفح فقط. المتجر في نسخة الويب تجريبي بدون دفع.',
    '',
  ].join('\r\n'));
}

if (watch) {
  writeStatic();
  const ctx = await esbuild.context({ ...options, plugins: [{ name: 'static', setup(b) { b.onEnd(() => writeStatic()); } }] });
  await ctx.watch();
} else {
  await esbuild.build(options);
  writeStatic();
  writeSingle();
  const size = (f) => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
  console.log('dist/game.js', size(path.join(dist, 'game.js')), '| dist-single/index.html', size(path.join(single, 'index.html')));
}
