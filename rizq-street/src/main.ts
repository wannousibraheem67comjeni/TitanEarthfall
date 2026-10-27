import '@fontsource/lalezar/arabic-400.css';
import '@fontsource/lalezar/latin-400.css';
import '@fontsource/readex-pro/arabic-400.css';
import '@fontsource/readex-pro/arabic-600.css';
import '@fontsource/readex-pro/latin-400.css';
import '@fontsource/readex-pro/latin-600.css';
import './ui/styles.css';
import { Game } from './game/Game';
import { loadSettings } from './game/progression';
import { newState, Store } from './game/state';
import { showIntro } from './ui/Intro';
import { SpeechInput, MIC_ERROR_TEXT, type MicError } from './voice/speech';

const root = document.getElementById('app')!;
const loading = document.getElementById('loading')!;
const bar = loading.querySelector<HTMLElement>('.bar > i')!;
const message = loading.querySelector<HTMLElement>('.message')!;

function fail(err: unknown): void {
  console.error(err);
  message.textContent = `ما قدرنا نشغّل اللعبة: ${err instanceof Error ? err.message : String(err)}`;
}

async function boot(): Promise<void> {
  if (!document.createElement('canvas').getContext('webgl2')) throw new Error('متصفحك ما يدعم WebGL 2. جرّب كروم أو إيدج أو سفاري حديث.');
  bar.style.width = '15%';
  message.textContent = 'نجهز الخطوط…';
  // Shop signs are drawn into textures, so the Arabic fonts must be ready first.
  await Promise.race([Promise.all([document.fonts.load('48px Lalezar', 'شارع'), document.fonts.load('600 16px "Readex Pro"', 'درهم'), document.fonts.load('16px "Readex Pro"', 'درهم')]), new Promise((r) => setTimeout(r, 2500))]);
  bar.style.width = '35%';
  message.textContent = 'نبني الفريج…';
  await new Promise((r) => setTimeout(r, 30));
  const settings = loadSettings();
  const game = new Game(root, settings);
  (window as unknown as { rizq: Game }).rizq = game;
  bar.style.width = '100%';
  game.renderer.render(game.scene, game.camera);
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 700);

  // A slow orbit behind the start screen.
  let spin = true;
  const t0 = performance.now();
  const orbit = () => {
    if (!spin) return;
    const t = (performance.now() - t0) / 1000;
    game.camera.position.set(-40 + Math.sin(t * 0.05) * 40, 14, 26 + Math.cos(t * 0.05) * 10);
    game.camera.lookAt(-30, 3, -6);
    game.sky.update(17.4, game.camera.position, game.camera.position);
    game.world.skyline.update(game.sky.fog.color, game.sky.night);
    game.renderer.render(game.scene, game.camera);
    requestAnimationFrame(orbit);
  };
  orbit();

  const saved = Store.load();
  const mic = new SpeechInput();
  mic.lang = settings.voiceLang;
  const choice = await showIntro(root, saved ? { name: saved.player.name, day: saved.day, money: saved.wallet + saved.bank } : null, async () => {
    if (!SpeechInput.supported()) throw MIC_ERROR_TEXT.unsupported;
    try {
      return await mic.listen(() => {});
    } catch (e) {
      throw MIC_ERROR_TEXT[(e as MicError) ?? 'other'] ?? MIC_ERROR_TEXT.other;
    }
  }, 'claude' in window);
  spin = false;
  game.sfx.unlock();
  game.sfx.startAmbience();
  const state = choice.continueSave && saved ? saved : newState(choice.name, choice.gender);
  const store = new Store(state);
  game.start(store);
  store.save();
}

boot().catch(fail);
