/**
 * A line-up of the people, for checking how they look (open the game with ?people).
 * Not part of play: it shows each kind of customer up close, in the shop's light.
 */
import { DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three';
import { Rng } from './core/rng';
import { makePersona } from './game/customers';
import { Human } from './world/humans';
import { View } from './world/render';

export function showcase(root: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  const scene = new Scene();
  const camera = new PerspectiveCamera(Number(params.get('fov') ?? 30), 1, 0.05, 100);
  const view = new View(root, scene, camera, params.get('q') === 'high' ? 'high' : 'medium');
  scene.add(new HemisphereLight('#fff6ea', '#8a7a68', 1.1));
  const key = new DirectionalLight('#fff4e5', 2.4);
  key.position.set(1.5, 3, 4);
  key.castShadow = true;
  scene.add(key);
  const floor = new Mesh(new PlaneGeometry(20, 20), new MeshStandardMaterial({ color: '#d9d2c6', roughness: 0.6 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const wall = new Mesh(new PlaneGeometry(20, 6), new MeshStandardMaterial({ color: '#efe9df', roughness: 0.9 }));
  wall.position.set(0, 3, -1.5);
  scene.add(wall);
  const rng = new Rng(Number(params.get('seed') ?? 3));
  const kinds = (params.get('people') || '0,1,2,3,4,kid').split(',');
  const humans: Human[] = [];
  kinds.forEach((k, i) => {
    const p = k === 'kid' ? makePersona(rng, 'kid') : makePersona(rng, 'normal', Number(k));
    const hmn = new Human(p.look);
    hmn.root.position.set((i - (kinds.length - 1) / 2) * 0.75, 0, 0);
    hmn.root.traverse((o) => (o.castShadow = true));
    scene.add(hmn.root);
    humans.push(hmn);
  });
  const focus = params.get('focus');
  const zoom = Number(params.get('zoom') ?? 6);
  const target = new Vector3(0, 1.1, 0);
  if (focus !== null) {
    const h = humans[Number(focus)];
    target.set(h.root.position.x, h.height * 0.9, 0);
  }
  camera.position.set(target.x, target.y + 0.1, zoom);
  camera.lookAt(target);
  const walk = params.get('walk') === '1';
  const talk = params.get('talk') === '1';
  for (const h of humans) {
    h.pose.lookAt = camera.position;
    h.pose.talking = talk;
    h.pose.speed = walk ? 1.2 : 0;
  }
  let last = performance.now();
  const tick = (dt: number) => {
    for (const h of humans) h.update(dt);
    view.render(dt);
  };
  (window as unknown as { tick: (dt: number) => void }).tick = tick;
  view.renderer.setAnimationLoop(() => {
    const now = performance.now();
    tick(Math.min(0.05, (now - last) / 1000));
    last = now;
  });
}
