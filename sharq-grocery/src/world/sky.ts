/**
 * Daylight over the east coast. The sun rises over the sea in the east, passes behind
 * the shop at noon and sets in the west; its colour warms near the horizon. After
 * sunset the sky turns deep blue, the street lamps and shop signs across the road
 * light up, and the shop's own LED panels carry the scene.
 */
import { Color, DirectionalLight, FogExp2, HemisphereLight, type Scene, Vector3 } from 'three';

const DAY_SKY = new Color('#bcd9ef');
const SUNSET_SKY = new Color('#f0b07e');
const NIGHT_SKY = new Color('#0b1426');
const DAWN_SKY = new Color('#e9c0a8');

const tmp = new Color();

export class DayLight {
  readonly sun = new DirectionalLight('#fff3df', 3);
  readonly hemi = new HemisphereLight('#bcd9ef', '#a08c72', 0.9);
  /** 0 at full day, 1 at full night. */
  night = 0;
  private readonly fog = new FogExp2('#bcd9ef', 0.006);

  constructor(
    private readonly scene: Scene,
    shadows: boolean,
    readonly focus: Vector3,
  ) {
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -24;
    cam.right = 24;
    cam.top = 24;
    cam.bottom = -24;
    cam.near = 1;
    cam.far = 120;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = this.fog;
    scene.background = new Color('#bcd9ef');
  }

  setShadowSize(size: number): void {
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  /** Light the scene for a time of day (shop minutes since midnight). */
  set(minute: number): number {
    const h = minute / 60;
    // Sunrise 06:00, sunset 18:30 (UAE, roughly).
    const a = (Math.PI * (h - 6)) / 12.5;
    const elev = Math.sin(a) * (72 * Math.PI) / 180;
    const day = Math.max(0, Math.min(1, (elev + 0.05) / 0.25));
    const low = 1 - Math.max(0, Math.min(1, elev / 0.45));
    this.night = 1 - day;
    // From the east (+x) through the south (behind the shop, +z) to the west.
    const dir = new Vector3(Math.cos(a) * Math.cos(elev), Math.max(0.12, Math.sin(elev)), Math.sin(a) * 0.55 * Math.cos(elev)).normalize();
    if (this.night > 0.95) dir.set(-0.3, 0.8, 0.4).normalize();
    this.sun.position.copy(this.focus).addScaledVector(dir, 60);
    this.sun.target.position.copy(this.focus);
    this.sun.color.set('#fff2dc').lerp(tmp.set('#ff9a52'), low * 0.85);
    this.sun.intensity = 3.2 * day * (0.35 + 0.65 * (1 - low * 0.6));
    if (this.night > 0.6) {
      // Moonlight.
      this.sun.color.set('#9fb3e0');
      this.sun.intensity = 0.1 * this.night;
    }
    // Sky and ambient.
    const sky = tmp.copy(DAY_SKY);
    if (h < 9) sky.lerp(DAWN_SKY, low * 0.8);
    else sky.lerp(SUNSET_SKY, low * 0.8);
    sky.lerp(NIGHT_SKY, this.night);
    (this.scene.background as Color).copy(sky);
    this.fog.color.copy(sky);
    this.hemi.color.copy(sky).lerp(new Color('#ffffff'), 0.2 * day);
    this.hemi.groundColor.set('#a08c72').lerp(new Color('#14110e'), this.night);
    this.hemi.intensity = 0.06 + 0.94 * day;
    return this.night;
  }
}
