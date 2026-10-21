// Renders the Google Play listing graphics (512x512 icon and 1024x500 feature graphic) from
// web/public/icon.svg. The PWA icons are produced by web/build.mjs.
// Run:  node tools/make-store-graphics.mjs   (needs Playwright + Chromium; see README)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const svg = fs.readFileSync(path.join(root, 'web/public/icon.svg'), 'utf8');
const outStore = path.join(root, 'store-listing/graphics');
fs.mkdirSync(outStore, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(html, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${html}`);
  return page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}
const b64 = (buf) => buf.toString('base64');
const icon = (size, pad = 0, bg = '') => `<div style="width:${size}px;height:${size}px;${bg ? 'background:' + bg + ';' : ''}display:grid;place-items:center"><div style="width:${size - 2 * pad}px;height:${size - 2 * pad}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div>`;

// Google Play listing assets
fs.writeFileSync(path.join(outStore, 'icon-512.png'), await render(icon(512), 512, 512));
const feature = `<div style="width:1024px;height:500px;background:linear-gradient(180deg,#46e0d2 0%,#17a8b4 55%,#0b5f78 100%);position:relative;overflow:hidden;font-family:'Baloo Bhaijaan 2',Arial,sans-serif">
  <div style="position:absolute;left:0;right:0;bottom:0;height:150px;background:linear-gradient(#1fd3e6,#0a7fa6)"></div>
  <div style="position:absolute;left:70px;top:90px;width:300px;height:300px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
  <div style="position:absolute;left:420px;top:120px;color:#ffe27a;font-size:120px;font-weight:800;line-height:1;text-shadow:0 6px 0 #7a4200,6px 0 0 #7a4200,-6px 0 0 #7a4200,0 -6px 0 #7a4200">Hopinet</div>
  <div style="position:absolute;left:424px;top:270px;color:#fff;font-size:44px;font-weight:700;text-shadow:0 4px 0 rgba(0,0,0,.35)">Hop. Swim. Soar.</div>
  <div dir="rtl" style="position:absolute;left:424px;top:340px;text-align:left;color:#fff;font-size:36px;font-weight:700;text-shadow:0 3px 0 rgba(0,0,0,.35)">اقفز. اسبح. حلّق!</div>
</div>`;
fs.writeFileSync(path.join(outStore, 'feature-graphic-1024x500.png'), await render(feature, 1024, 500));
await browser.close();
console.log('store graphics written');
