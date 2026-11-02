/**
 * The renderer, at three quality levels. "high" (desktop): soft shadows, ambient
 * occlusion in the corners and under shelves, a gentle bloom on lights and screens,
 * multisampled edges. "medium" (phones): shadows and antialiasing, no post effects.
 * "low": the bare picture, for slow devices. It steps down by itself if the frame
 * rate stays low.
 */
import { HalfFloatType, NeutralToneMapping, PCFShadowMap, PMREMGenerator, type PerspectiveCamera, type Scene, SRGBColorSpace, Vector2, WebGLRenderer, WebGLRenderTarget } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export type Quality = 'high' | 'medium' | 'low';

export function pickQuality(): Quality {
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'high' || q === 'medium' || q === 'low') return q;
  return matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';
}

export class View {
  readonly renderer: WebGLRenderer;
  private composer: EffectComposer | null = null;
  private frames = 0;
  private slowFor = 0;
  private acc = 0;
  onDowngrade: ((q: Quality) => void) | null = null;

  constructor(
    root: HTMLElement,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    public quality: Quality,
  ) {
    this.renderer = new WebGLRenderer({ antialias: quality !== 'high', powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.domElement.className = 'view';
    root.prepend(this.renderer.domElement);
    // Image-based light: soft reflections on glass, tiles, cans and car paint.
    const pmrem = new PMREMGenerator(this.renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.5;
    pmrem.dispose();
    this.apply();
  }

  get shadows(): boolean {
    return this.quality !== 'low';
  }

  private apply(): void {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(this.quality === 'low' ? 1 : Math.min(dpr, coarse ? 1.75 : 2));
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.composer?.dispose();
    this.composer = null;
    if (this.quality === 'high') {
      const size = this.renderer.getDrawingBufferSize(new Vector2());
      const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 });
      const c = new EffectComposer(this.renderer, target);
      c.addPass(new RenderPass(this.scene, this.camera));
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1, scale: 1.1, samples: 12 });
      ao.blendIntensity = 0.85;
      c.addPass(ao);
      c.addPass(new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.22, 0.4, 2.4));
      c.addPass(new OutputPass());
      this.composer = c;
    }
    this.resize();
  }

  resize(): void {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number): void {
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    // Watch the frame rate for a few seconds at a time; step down if it stays low.
    this.frames++;
    this.acc += dt;
    if (this.acc >= 3) {
      const fps = this.frames / this.acc;
      this.frames = 0;
      this.acc = 0;
      this.slowFor = fps < 26 ? this.slowFor + 1 : 0;
      if (this.slowFor >= 2 && this.quality !== 'low' && !new URLSearchParams(location.search).get('q')) {
        this.quality = this.quality === 'high' ? 'medium' : 'low';
        this.slowFor = 0;
        this.apply();
        this.onDowngrade?.(this.quality);
      }
    }
  }
}
