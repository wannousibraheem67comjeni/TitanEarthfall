import './ui/styles.css';
import { App } from './app/App';

const root = document.getElementById('app')!;
const loading = document.getElementById('loading')!;
const bar = loading.querySelector<HTMLElement>('.bar > span')!;
const message = loading.querySelector<HTMLElement>('.message')!;

function fail(err: unknown): void {
  console.error(err);
  loading.classList.add('error');
  message.textContent = `Could not start the simulation: ${err instanceof Error ? err.message : String(err)}`;
}

if (!document.createElement('canvas').getContext('webgl2')) {
  fail(new Error('WebGL 2 is not available in this browser.'));
} else {
  const app = new App(root);
  // Console / automation hook (e.g. `egypt3d.scene`), handy for debugging and tests.
  (window as unknown as { egypt3d: App }).egypt3d = app;
  app
    .start((msg, f) => {
      message.textContent = msg;
      bar.style.width = `${Math.round(f * 100)}%`;
    })
    .then(() => {
      loading.classList.add('done');
      setTimeout(() => loading.remove(), 900);
    })
    .catch(fail);
}
