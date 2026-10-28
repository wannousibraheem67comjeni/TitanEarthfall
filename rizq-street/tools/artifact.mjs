// Turns the single-file build into a claude.ai artifact page: the viewer supplies the
// <html>/<head>/<body> skeleton itself, so the page starts with its <title> and <style>,
// then the body markup, then the inlined module script.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../dist-single/index.html', import.meta.url), 'utf8');
const pick = (re, what) => {
  const m = src.match(re);
  if (!m) throw new Error(`could not find ${what} in dist-single/index.html`);
  return m[0];
};
const title = pick(/<title>[\s\S]*?<\/title>/, 'title');
const style = pick(/<style[^>]*>[\s\S]*?<\/style>/, 'style').replace(/<style[^>]*>/, '<style>');
// A bundled library writes U+FFFD literally inside a string; escape it so the page
// text carries no replacement characters.
const script = pick(/<script type="module"[^>]*>[\s\S]*?<\/script>/, 'script').replace(/\uFFFD/g, '\\uFFFD');
const body = pick(/<body>[\s\S]*?<\/body>/, 'body')
  .replace(/^<body>/, '')
  .replace(/<\/body>$/, '')
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .trim();
const out = `${title}\n${style}\n${body}\n${script}\n`;
writeFileSync(new URL('../dist-single/artifact.html', import.meta.url), out);
console.log(`artifact.html: ${(out.length / 1024).toFixed(0)} KiB`);
