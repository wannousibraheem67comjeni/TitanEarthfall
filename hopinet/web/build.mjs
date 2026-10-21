// Builds Hopinet into:
//   dist/         multi-file web game (also what the Android app bundles) + PWA files
//   dist-single/  one self-contained index.html (everything inlined) for double-click / itch.io / email
// The repository stays plain text: the Baloo Bhaijaan 2 font (SIL OFL) comes from the
// @fontsource-variable package and the PNG icons are rendered from public/icon.svg with sharp.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(root, 'dist');
const single = path.join(root, 'dist-single');
const watch = process.argv.includes('--watch');
const version = /GAME_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(root, 'src/config.js'), 'utf8'))[1];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, path.join(dst, f)); else fs.copyFileSync(s, path.join(dst, f));
  }
}

// Fonts (Arabic + Latin subsets of the variable font) and launcher icons are generated, not stored.
async function writeGenerated() {
  const fontSrc = path.join(root, 'node_modules/@fontsource-variable/baloo-bhaijaan-2/files');
  fs.mkdirSync(path.join(dist, 'fonts'), { recursive: true });
  fs.copyFileSync(path.join(fontSrc, 'baloo-bhaijaan-2-arabic-wght-normal.woff2'), path.join(dist, 'fonts/baloo-arabic.woff2'));
  fs.copyFileSync(path.join(fontSrc, 'baloo-bhaijaan-2-latin-wght-normal.woff2'), path.join(dist, 'fonts/baloo-latin.woff2'));
  const ofl = path.join(root, 'node_modules/@fontsource-variable/baloo-bhaijaan-2/LICENSE');
  if (fs.existsSync(ofl)) fs.copyFileSync(ofl, path.join(dist, 'fonts/OFL.txt'));
  const svg = fs.readFileSync(path.join(root, 'public/icon.svg'));
  for (const size of [192, 512]) await sharp(svg, { density: 384 }).resize(size, size).png().toFile(path.join(dist, `icon-${size}.png`));
  // Maskable icon: full-bleed background with the artwork inside the 80% safe zone.
  const art = await sharp(svg, { density: 384 }).resize(410, 410).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: '#17a8b4' } })
    .composite([{ input: art, gravity: 'center' }]).png().toFile(path.join(dist, 'icon-maskable-512.png'));
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

async function writeStatic() {
  copyDir(path.join(root, 'public'), dist);
  await writeGenerated();
  fs.copyFileSync(path.join(root, 'src/index.html'), path.join(dist, 'index.html'));
  fs.copyFileSync(path.join(root, 'src/style.css'), path.join(dist, 'style.css'));
  const sw = path.join(dist, 'sw.js');
  fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace('__VERSION__', version));
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
  html = html.replace('<link rel="manifest" href="manifest.webmanifest">\n', '');
  html = html.replace(/<script>\n\/\/ Installable offline web app[\s\S]*?<\/script>\n/, '');
  html = html.replace('<script src="game.js"></script>', () => `<script>${js}</script>`);
  fs.writeFileSync(path.join(single, 'index.html'), html);
  fs.writeFileSync(path.join(single, 'README.txt'), [
    `Hopinet ${version} - offline web build / هوبينت - نسخة ويب أوفلاين`,
    '',
    'Open index.html with a double-click (Chrome, Edge, Firefox, Safari). No internet, server or database needed.',
    'افتح الملف index.html بنقرة مزدوجة. لا يحتاج إنترنت ولا خادم ولا قاعدة بيانات.',
    '',
    'Progress is saved in this browser only. Nothing can be bought in this web build and no purchases are granted;',
    'real-money purchases exist only through Google Play in the Android app (Play edition).',
    'يُحفظ التقدم في هذا المتصفح فقط. لا يمكن شراء أي شيء في نسخة الويب ولا تُمنح فيها أي مشتريات؛',
    'الشراء بأموال حقيقية يتم فقط عبر Google Play في تطبيق أندرويد (نسخة Play).',
    '',
  ].join('\r\n'));
}

if (watch) {
  await writeStatic();
  const ctx = await esbuild.context({ ...options, plugins: [{ name: 'static', setup(b) { b.onEnd(() => writeStatic()); } }] });
  await ctx.watch();
} else {
  await esbuild.build(options);
  await writeStatic();
  writeSingle();
  const size = (f) => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
  console.log('dist/game.js', size(path.join(dist, 'game.js')), '| dist-single/index.html', size(path.join(single, 'index.html')));
}
