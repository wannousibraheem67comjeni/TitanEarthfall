import '@fontsource/lalezar/arabic-400.css';
import '@fontsource/lalezar/latin-400.css';
import '@fontsource/readex-pro/arabic-400.css';
import '@fontsource/readex-pro/arabic-600.css';
import '@fontsource/readex-pro/latin-400.css';
import '@fontsource/readex-pro/latin-600.css';
import './ui/styles.css';
import { Game } from './game/Game';
import { newState, Store } from './game/state';
import { showIntro } from './ui/overlays';
import { showcase } from './showcase';

const root = document.getElementById('app')!;
const loading = document.getElementById('loading')!;
const bar = loading.querySelector<HTMLElement>('.bar > i')!;
const message = loading.querySelector<HTMLElement>('.message')!;

async function boot(): Promise<void> {
  if (!document.createElement('canvas').getContext('webgl2')) throw new Error('متصفحك ما يدعم WebGL 2. جرّب كروم أو إيدج أو سفاري حديث.');
  bar.style.width = '20%';
  message.textContent = 'نجهز الخطوط…';
  // The shop sign is drawn into a texture, so the Arabic fonts must be ready first.
  await Promise.race([Promise.all([document.fonts.load('48px Lalezar', 'بقالة'), document.fonts.load('600 16px "Readex Pro"', 'درهم'), document.fonts.load('16px "Readex Pro"', 'درهم')]), new Promise((r) => setTimeout(r, 2500))]);
  bar.style.width = '60%';
  message.textContent = 'نفتح البقالة…';
  await new Promise((r) => setTimeout(r, 30));
  if (new URLSearchParams(location.search).has('people')) {
    loading.remove();
    showcase(root);
    return;
  }
  const game = new Game(root);
  (window as unknown as { shop: Game }).shop = game;
  bar.style.width = '100%';
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 600);

  const saved = Store.load();
  const savedWorth = saved ? new Store(saved).worth : 0;
  const choice = await showIntro(root, saved ? { name: saved.name, gender: saved.gender, stage: saved.stage, worth: savedWorth } : null, () => {
    game.sfx.unlock();
    game.voice.unlock();
    game.sfx.startAmbience();
  });
  const first = !(choice.continueSave && saved);
  const store = new Store(first ? newState(choice.name, choice.gender) : saved!);
  game.start(store, first);
  store.persist();
}

boot().catch((err) => {
  console.error(err);
  message.textContent = `ما قدرنا نفتح اللعبة: ${err instanceof Error ? err.message : String(err)}`;
});
