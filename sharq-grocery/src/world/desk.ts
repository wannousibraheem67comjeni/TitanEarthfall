/**
 * The shopkeeper's desk, in the foreground of every shot: the till with its screen
 * listing what is being rung up, a receipt printer that prints as the customer names
 * each item, a card machine, a barcode scanner, a rack of sweets, the charity box, a
 * glass of karak, the debt book, a phone and a small flag. Customers' goods land on the
 * free middle of the desk, and the banknote they hand over lies where it can be checked.
 */
import { BoxGeometry, CanvasTexture, CylinderGeometry, Group, Mesh, MeshStandardMaterial, type Object3D, PlaneGeometry, SphereGeometry, Vector3 } from 'three';
import type { Product } from '../game/economy';
import { mat } from './products';
import type { ShopLayout } from './shop';
import { BODY_FONT, cached, canvas, DISPLAY_FONT, flagTexture, quartz, toTexture, wood } from './textures';

export interface DeskLine {
  product: Product;
  qty: number;
}

export interface Desk {
  group: Group;
  /** Put an item on the desk at the next free place (world coordinates handled here). */
  place(obj: Object3D): Vector3;
  /** Take every item off the desk (into the customer's bag, or back to the shelf). */
  clear(): Object3D[];
  /** The till screen: what has been rung up, the total, how they pay. */
  screen(lines: DeskLine[], total: number, footer: string): void;
  terminal(state: 'idle' | 'card' | 'ok'): void;
  /** Receipt paper coming out of the printer (0 = none, 1 = a full slip). */
  paper(amount: number): void;
  note(value: number | null, fake?: boolean): void;
  debtBook(open: boolean): void;
  update(dt: number): void;
  /** Where the goods go, for the customer's hands to reach. */
  itemZone: Vector3;
}

const BG = '#0d1b2a';

function screenCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  return canvas(640, 480);
}

function drawScreen(ctx: CanvasRenderingContext2D, lines: DeskLine[], total: number, footer: string): void {
  const W = 640;
  const H = 480;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#e8508f';
  ctx.fillRect(0, 0, W, 58);
  ctx.fillStyle = '#fff';
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = `34px ${DISPLAY_FONT}`;
  ctx.fillText('بقالة شرق الإمارات', W - 20, 32);
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';
  ctx.font = `500 20px ${BODY_FONT}`;
  ctx.fillText('POS 01', 20, 32);
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.font = `500 28px ${BODY_FONT}`;
  const shown = lines.slice(-7);
  shown.forEach((l, i) => {
    const y = 96 + i * 44;
    ctx.fillStyle = i % 2 ? '#13263a' : '#102233';
    ctx.fillRect(0, y - 22, W, 44);
    ctx.fillStyle = '#e8f1ff';
    ctx.textAlign = 'right';
    ctx.fillText(l.product.name, W - 20, y);
    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    ctx.fillStyle = '#9fd0ff';
    ctx.fillText(`${l.qty} × ${l.product.price.toFixed(2)}`, 190, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText((l.qty * l.product.price).toFixed(2), 20, y);
    ctx.direction = 'rtl';
  });
  if (!lines.length) {
    ctx.fillStyle = '#5c7a99';
    ctx.textAlign = 'center';
    ctx.font = `30px ${DISPLAY_FONT}`;
    ctx.fillText('أهلاً وسهلاً', W / 2, 210);
    ctx.font = `500 22px ${BODY_FONT}`;
    ctx.fillText('بانتظار الزبون…', W / 2, 256);
  }
  ctx.fillStyle = '#1d3b58';
  ctx.fillRect(0, H - 104, W, 104);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.font = `40px ${DISPLAY_FONT}`;
  ctx.fillText('المجموع', W - 20, H - 66);
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';
  ctx.font = `600 48px ${BODY_FONT}`;
  ctx.fillStyle = '#7dffb0';
  ctx.fillText(`${total.toFixed(2)} AED`, 20, H - 64);
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.font = `500 21px ${BODY_FONT}`;
  ctx.fillStyle = '#9fb7cf';
  ctx.fillText(footer, W - 20, H - 22);
}

function terminalCanvas(state: 'idle' | 'card' | 'ok'): CanvasTexture {
  return cached(`term${state}`, () => {
    const [c, ctx] = canvas(160, 128);
    ctx.fillStyle = state === 'ok' ? '#0f5f34' : state === 'card' ? '#123a66' : '#1b2430';
    ctx.fillRect(0, 0, 160, 128);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    ctx.font = `600 20px ${BODY_FONT}`;
    ctx.fillText(state === 'ok' ? 'تمت العملية ✓' : state === 'card' ? 'قرّب البطاقة' : 'مرحباً', 80, 50);
    ctx.font = `500 14px ${BODY_FONT}`;
    ctx.fillText(state === 'card' ? 'Tap / Insert' : 'Card · Apple Pay', 80, 88);
    return toTexture(c);
  });
}

/** Banknote colours by value (close to the real dirham notes). */
const NOTE_COLORS: Record<number, [string, string]> = {
  5: ['#a7743f', '#6e4a28'],
  10: ['#4f8a4c', '#2f5a2e'],
  20: ['#3f78ad', '#24496e'],
  50: ['#7b56a6', '#4c3170'],
  100: ['#c43b33', '#7e2420'],
  200: ['#6c8f3a', '#435d22'],
  500: ['#2f5fa8', '#1d3a69'],
  1000: ['#8e6c3c', '#5b4424'],
};

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arabicNumber = (n: number) => String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);

const NOTES = [1000, 500, 200, 100, 50, 20, 10, 5];

/** How an amount is handed over: banknotes, then dirham and fils coins. */
export function cashParts(amount: number): { notes: number[]; coins: number[] } {
  const notes: number[] = [];
  const coins: number[] = [];
  let left = Math.round(amount * 100) / 100;
  for (const n of NOTES)
    while (left >= n - 1e-6 && notes.length < 6) {
      notes.push(n);
      left = Math.round((left - n) * 100) / 100;
    }
  for (const c of [1, 0.5, 0.25])
    while (left >= c - 1e-6 && coins.length < 9) {
      coins.push(c);
      left = Math.round((left - c) * 100) / 100;
    }
  return { notes, coins };
}

/** Everything handed over, drawn together: notes fanned out, coins in front. */
export function cashCanvas(amount: number, fake: boolean): HTMLCanvasElement {
  const { notes, coins } = cashParts(amount);
  if (notes.length === 1 && !coins.length) return banknoteCanvas(notes[0], fake);
  const [c, ctx] = canvas(560, 300);
  ctx.clearRect(0, 0, 560, 300);
  notes.forEach((n, i) => {
    ctx.save();
    ctx.translate(40 + i * 22, 20 + i * 14);
    ctx.rotate((i - notes.length / 2) * 0.04);
    ctx.drawImage(banknoteCanvas(n, fake && i === 0), 0, 0, 400, 183);
    ctx.restore();
  });
  coins.forEach((v, i) => {
    const x = 70 + i * 52;
    const y = notes.length ? 250 : 150;
    const r = v === 1 ? 24 : v === 0.5 ? 21 : 17;
    const g = ctx.createRadialGradient(x - 6, y - 6, 2, x, y, r);
    g.addColorStop(0, '#f4f4f2');
    g.addColorStop(1, v === 1 ? '#9a9da2' : '#b9a46a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.font = `600 ${v === 1 ? 18 : 14}px ${BODY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(v === 1 ? '1' : v === 0.5 ? '50' : '25', x, y);
  });
  return c;
}

/** A dirham banknote. A fake one is washed out, has no security thread, and says «درهن». */
export function banknoteCanvas(value: number, fake: boolean): HTMLCanvasElement {
  const [c, ctx] = canvas(480, 220);
  const [a, b] = NOTE_COLORS[value] ?? NOTE_COLORS[100];
  const g = ctx.createLinearGradient(0, 0, 480, 220);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 480, 220);
  // Guilloche.
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    ctx.beginPath();
    for (let x = 0; x <= 480; x += 6) {
      const y = 110 + Math.sin(x / 22 + i * 0.5) * (30 + i * 2.5) * Math.sin(x / 140 + i);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Watermark window and a falcon-like emblem.
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.ellipse(400, 110, 52, 70, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.moveTo(400, 70);
  ctx.quadraticCurveTo(440, 100, 420, 150);
  ctx.quadraticCurveTo(400, 120, 380, 150);
  ctx.quadraticCurveTo(360, 100, 400, 70);
  ctx.fill();
  if (!fake) {
    // Security thread.
    ctx.fillStyle = 'rgba(210,215,225,0.9)';
    ctx.fillRect(300, 0, 7, 220);
    ctx.fillStyle = 'rgba(120,120,140,0.6)';
    for (let y = 4; y < 220; y += 14) ctx.fillRect(300, y, 7, 5);
  }
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 64px ${BODY_FONT}`;
  ctx.fillText(String(value), 82, 64);
  ctx.font = `64px ${DISPLAY_FONT}`;
  ctx.direction = 'rtl';
  ctx.fillText(arabicNumber(value), 200, 150);
  ctx.font = `36px ${DISPLAY_FONT}`;
  ctx.fillText(fake ? 'درهن' : value === 1 ? 'درهم' : 'دراهم', 200, 80);
  ctx.font = `500 15px ${BODY_FONT}`;
  ctx.fillText('الإمارات العربية المتحدة', 200, 196);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, 464, 204);
  if (fake) {
    // Washed out and slightly off.
    const img = ctx.getImageData(0, 0, 480, 220);
    for (let i = 0; i < img.data.length; i += 4) {
      const m = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
      img.data[i] = m * 0.55 + img.data[i] * 0.45 + 18;
      img.data[i + 1] = m * 0.55 + img.data[i + 1] * 0.45 + 14;
      img.data[i + 2] = m * 0.55 + img.data[i + 2] * 0.45 + 6;
    }
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

export function buildDesk(stage: number, layout: ShopLayout, shadows: boolean): Desk {
  const group = new Group();
  const { deskZ, deskTop, deskHalf } = layout;
  const D = 0.62;
  const topMat = stage >= 3 ? new MeshStandardMaterial({ map: quartz().map, roughness: 0.18 }) : new MeshStandardMaterial({ map: wood('#a87850').map, roughness: 0.45 });
  topMat.map = topMat.map!.clone();
  topMat.map.needsUpdate = true;
  topMat.map.repeat.set((deskHalf * 2) / 1.2, D / 1.2);
  const add = (geo: BoxGeometry | CylinderGeometry | PlaneGeometry | SphereGeometry, m: MeshStandardMaterial | MeshStandardMaterial[], x: number, y: number, z: number, ry = 0, rx = 0) => {
    const mesh = new Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, 0);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  // Counter body and top.
  const bodyMat = mat(stage >= 3 ? '#f4f4f2' : '#efe6d8', 0.5);
  add(new BoxGeometry(deskHalf * 2, deskTop - 0.04, D), bodyMat, 0, (deskTop - 0.04) / 2, deskZ);
  add(new BoxGeometry(deskHalf * 2 + 0.04, 0.04, D + 0.04), topMat, 0, deskTop - 0.02, deskZ);
  // Pink band on the customer side.
  add(new BoxGeometry(deskHalf * 2, 0.12, 0.01), mat('#e8508f', 0.4), 0, deskTop - 0.25, deskZ - D / 2 - 0.004);
  const R = deskHalf;
  const front = deskZ - D / 2;
  const back = deskZ + D / 2;

  // The till: a monitor tilted toward the shopkeeper.
  const [scrC, scrCtx] = screenCanvas();
  drawScreen(scrCtx, [], 0, 'ضريبة القيمة المضافة 5٪ مشمولة');
  const scrTex = toTexture(scrC);
  const screenMat = new MeshStandardMaterial({ map: scrTex, emissive: '#ffffff', emissiveMap: scrTex, emissiveIntensity: 0.85, roughness: 0.25 });
  const posX = R - 0.17;
  const posZ = deskZ + 0.02;
  add(new BoxGeometry(0.2, 0.015, 0.16), mat('#202226', 0.4), posX, deskTop + 0.008, posZ);
  add(new CylinderGeometry(0.018, 0.022, 0.1, 10), mat('#202226', 0.4), posX, deskTop + 0.06, posZ - 0.02);
  const mon = new Group();
  mon.position.set(posX, deskTop + 0.2, posZ - 0.03);
  mon.rotation.set(-0.3, Math.PI - 0.45, 0);
  const bezel = new Mesh(new BoxGeometry(0.3, 0.225, 0.022), mat('#18191c', 0.35));
  const scr = new Mesh(new PlaneGeometry(0.28, 0.205), screenMat);
  scr.position.z = -0.0135;
  scr.rotation.y = Math.PI;
  mon.add(bezel, scr);
  group.add(mon);
  // The customer's pole display, facing out.
  add(new BoxGeometry(0.2, 0.06, 0.03), mat('#18191c', 0.4), posX + 0.05, deskTop + 0.47, posZ - 0.12, 0.3);
  add(new BoxGeometry(0.18, 0.04, 0.005), mat('#33ffa0', 0.3, 0, { emissive: '#1fcf7a' }), posX + 0.05, deskTop + 0.47, posZ - 0.137, 0.3);
  add(new CylinderGeometry(0.01, 0.01, 0.3, 8), mat('#202226', 0.4), posX + 0.05, deskTop + 0.29, posZ - 0.1);

  // Receipt printer with paper.
  const prX = R - 0.62;
  const prZ = back - 0.13;
  add(new BoxGeometry(0.14, 0.12, 0.19), mat('#26282c', 0.45), prX, deskTop + 0.06, prZ);
  add(new BoxGeometry(0.1, 0.004, 0.02), mat('#0d0e10', 0.6), prX, deskTop + 0.121, prZ - 0.06);
  const paperMesh = add(new PlaneGeometry(0.08, 0.2).translate(0, 0.1, 0), mat('#fbfbf6', 0.85, 0, { side: true }), prX, deskTop + 0.12, prZ - 0.062, Math.PI, -0.25);
  paperMesh.scale.y = 0.001;

  // Card terminal, facing the customer.
  const termTexIdle = terminalCanvas('idle');
  const termMat = new MeshStandardMaterial({ map: termTexIdle, emissive: '#ffffff', emissiveMap: termTexIdle, emissiveIntensity: 0.8, roughness: 0.3 });
  const term = new Group();
  term.position.set(R - 0.5, deskTop, front + 0.14);
  term.rotation.y = 0.35;
  const tb = new Mesh(new BoxGeometry(0.085, 0.03, 0.17), mat('#141518', 0.4));
  tb.position.y = 0.015;
  tb.rotation.x = 0.25;
  const ts = new Mesh(new PlaneGeometry(0.065, 0.05), termMat);
  ts.position.set(0, 0.034, -0.035);
  ts.rotation.set(-Math.PI / 2 + 0.25, 0, Math.PI);
  const keys = new Mesh(new PlaneGeometry(0.06, 0.06), new MeshStandardMaterial({ map: keypadTexture(), roughness: 0.6 }));
  keys.position.set(0, 0.026, 0.035);
  keys.rotation.set(-Math.PI / 2 + 0.25, 0, Math.PI);
  term.add(tb, ts, keys);
  group.add(term);

  // Barcode scanner in its cradle.
  const scX = R - 0.86;
  add(new BoxGeometry(0.07, 0.03, 0.09), mat('#2a2c30', 0.5), scX, deskTop + 0.015, back - 0.12);
  add(new BoxGeometry(0.05, 0.13, 0.05), mat('#ffb000', 0.4), scX, deskTop + 0.09, back - 0.12, 0, -0.35);

  // Left side: sweets, the charity box, the karak, the debt book, a phone, the flag.
  const L = -R;
  const rack = new Group();
  rack.position.set(L + 0.17, deskTop, front + 0.14);
  for (let i = 0; i < 3; i++) {
    const tier = new Mesh(new BoxGeometry(0.26, 0.012, 0.07), mat('#d7dade', 0.35, 0.6));
    tier.position.set(0, 0.04 + i * 0.075, -0.06 + i * 0.05);
    rack.add(tier);
    const colors = ['#e85aa0', '#f2c230', '#3f86b8', '#7a3fb3', '#e04b2a'];
    for (let j = 0; j < 5; j++) {
      const bar = new Mesh(new BoxGeometry(0.04, 0.012, 0.06), mat(colors[(j + i) % 5], 0.35));
      bar.position.set(-0.1 + j * 0.05, 0.052 + i * 0.075, -0.06 + i * 0.05);
      bar.rotation.x = -0.3;
      rack.add(bar);
    }
  }
  group.add(rack);
  const charity = new Group();
  charity.position.set(L + 0.42, deskTop, front + 0.1);
  const cbox = new Mesh(new BoxGeometry(0.11, 0.14, 0.11), mat('#e9f6ff', 0.05, 0, { opacity: 0.35 }));
  cbox.position.y = 0.07;
  const coins = new Mesh(new BoxGeometry(0.1, 0.035, 0.1), mat('#c9a54a', 0.3, 1));
  coins.position.y = 0.018;
  const clabel = new Mesh(new PlaneGeometry(0.1, 0.05), new MeshStandardMaterial({ map: charityLabel(), roughness: 0.5 }));
  clabel.position.set(0, 0.1, -0.056);
  clabel.rotation.y = Math.PI;
  charity.add(coins, cbox, clabel);
  group.add(charity);
  // Karak in a small glass on a saucer.
  const tea = new Group();
  tea.position.set(L + 0.2, deskTop, back - 0.13);
  const saucer = new Mesh(new CylinderGeometry(0.05, 0.04, 0.008, 20), mat('#f7f7f4', 0.2));
  const glass = new Mesh(new CylinderGeometry(0.026, 0.02, 0.075, 16, 1, true), mat('#eaf6ff', 0.04, 0, { opacity: 0.35, side: true }));
  glass.position.y = 0.045;
  const chai = new Mesh(new CylinderGeometry(0.024, 0.019, 0.055, 16), mat('#a9774a', 0.3));
  chai.position.y = 0.036;
  tea.add(saucer, chai, glass);
  group.add(tea);
  // The debt book (closed; opens when someone takes goods on credit).
  const bookClosed = add(new BoxGeometry(0.15, 0.02, 0.21), mat('#9c2a2a', 0.6), L + 0.48, deskTop + 0.01, back - 0.16, 0.15);
  const bookOpen = add(new BoxGeometry(0.3, 0.012, 0.21), new MeshStandardMaterial({ map: ledgerTexture(), roughness: 0.8 }), L + 0.5, deskTop + 0.006, back - 0.16, 0.15);
  bookOpen.visible = false;
  // Phone.
  add(new BoxGeometry(0.075, 0.009, 0.155), mat('#121316', 0.2, 0.3), -0.05, deskTop + 0.005, back - 0.1, -0.2);
  // Flag on a little stand.
  add(new CylinderGeometry(0.003, 0.003, 0.22, 6), mat('#c9a54a', 0.3, 1), L + 0.06, deskTop + 0.11, deskZ + 0.02);
  add(new CylinderGeometry(0.03, 0.035, 0.012, 16), mat('#2a2a2a', 0.4), L + 0.06, deskTop + 0.006, deskZ + 0.02);
  const flag = add(new PlaneGeometry(0.12, 0.06), new MeshStandardMaterial({ map: flagTexture(), roughness: 0.7, side: 2 }), L + 0.12, deskTop + 0.19, deskZ + 0.02, Math.PI - 0.5);

  // The banknote the customer hands over.
  let noteMesh: Mesh | null = null;
  const noteAt = new Vector3(0.12, deskTop + 0.002, front + 0.22);

  // Where goods are set down: the clear middle of the desk.
  const x0 = L + 0.62;
  const x1 = R - 0.72;
  const items: Object3D[] = [];
  const itemZone = new Vector3((x0 + x1) / 2, deskTop, front + 0.2);
  const place = (obj: Object3D) => {
    const n = items.length;
    const cols = Math.max(2, Math.floor((x1 - x0) / 0.17));
    const col = n % cols;
    const row = Math.floor(n / cols) % 2;
    const lift = Math.floor(n / (cols * 2)) * 0.06;
    const size = (obj.userData.size as Vector3 | undefined) ?? new Vector3(0.1, 0.1, 0.1);
    const big = size.x > 0.4;
    const pos = big ? new Vector3((x0 + x1) / 2, deskTop + 0.002 + lift, front + 0.26) : new Vector3(x0 + 0.08 + col * ((x1 - x0 - 0.16) / Math.max(1, cols - 1)), deskTop + 0.002 + lift, front + 0.13 + row * 0.2);
    obj.position.copy(pos);
    obj.rotation.set(0, Math.PI + (Math.sin(n * 7.1) * 0.35), 0);
    if (big) {
      // Too big for the desk top: it leans against the front of the desk.
      obj.position.set((x0 + x1) / 2, 0, front - 0.25);
      obj.rotation.set(0, Math.PI, 0);
    }
    group.add(obj);
    items.push(obj);
    return pos;
  };

  let paperTarget = 0;
  let t = 0;
  return {
    group,
    itemZone,
    place,
    clear() {
      const out = items.splice(0);
      for (const o of out) o.removeFromParent();
      return out;
    },
    screen(lines, total, footer) {
      drawScreen(scrCtx, lines, total, footer);
      scrTex.needsUpdate = true;
    },
    terminal(state) {
      const tex = terminalCanvas(state);
      termMat.map = tex;
      termMat.emissiveMap = tex;
      termMat.needsUpdate = true;
    },
    paper(amount) {
      paperTarget = amount;
    },
    note(value, fake = false) {
      if (noteMesh) {
        noteMesh.removeFromParent();
        noteMesh.traverse((o) => {
          const m = (o as Mesh).material as MeshStandardMaterial | undefined;
          if (m && m.map) m.map.dispose();
        });
        noteMesh = null;
      }
      if (value === null) return;
      // The banknotes fanned out, the coins beside them.
      const { notes, coins } = cashParts(value);
      const g = new Group();
      notes.forEach((n, i) => {
        const tex = toTexture(banknoteCanvas(n, fake && i === 0));
        const m = new Mesh(new PlaneGeometry(0.15, 0.069), new MeshStandardMaterial({ map: tex, roughness: 0.75 }));
        m.rotation.set(-Math.PI / 2, 0, Math.PI + 0.12 - i * 0.08);
        m.position.set(-i * 0.012, i * 0.0008, i * 0.01);
        m.receiveShadow = true;
        g.add(m);
      });
      coins.forEach((v, i) => {
        const m = new Mesh(new CylinderGeometry(v === 1 ? 0.012 : 0.0105, v === 1 ? 0.012 : 0.0105, 0.002, 20), mat(v === 1 ? '#c7c9cc' : '#c9b06a', 0.3, 1));
        m.position.set(0.1 + (i % 3) * 0.028, 0.001 + Math.floor(i / 3) * 0.002, -0.03 + Math.floor(i / 3) * 0.004);
        m.castShadow = true;
        g.add(m);
      });
      g.position.copy(noteAt);
      group.add(g);
      noteMesh = g as unknown as Mesh;
    },
    debtBook(open) {
      bookOpen.visible = open;
      bookClosed.visible = !open;
    },
    update(dt) {
      t += dt;
      paperMesh.scale.y += (Math.max(0.001, paperTarget) - paperMesh.scale.y) * Math.min(1, dt * 3);
      flag.rotation.y = Math.PI - 0.5 + Math.sin(t * 1.3) * 0.04;
    },
  };
}

function keypadTexture(): CanvasTexture {
  return cached('keypad', () => {
    const [c, ctx] = canvas(96, 96);
    ctx.fillStyle = '#141518';
    ctx.fillRect(0, 0, 96, 96);
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = r === 3 && k !== 1 ? (k === 0 ? '#c0392b' : '#27ae60') : '#3a3d44';
        ctx.fillRect(8 + k * 28, 6 + r * 22, 22, 16);
      }
    return toTexture(c);
  });
}

function charityLabel(): CanvasTexture {
  return cached('charity', () => {
    const [c, ctx] = canvas(200, 100);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 200, 100);
    ctx.fillStyle = '#0f7a3c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `34px ${DISPLAY_FONT}`;
    ctx.fillText('صندوق الخير', 100, 46);
    ctx.font = `500 16px ${BODY_FONT}`;
    ctx.fillText('ساهم ولو بدرهم', 100, 80);
    return toTexture(c);
  });
}

function ledgerTexture(): CanvasTexture {
  return cached('ledger', () => {
    const [c, ctx] = canvas(512, 360);
    ctx.fillStyle = '#fbf7ec';
    ctx.fillRect(0, 0, 512, 360);
    ctx.strokeStyle = '#a9c4e6';
    for (let y = 40; y < 360; y += 26) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }
    ctx.strokeStyle = '#d97b7b';
    ctx.beginPath();
    ctx.moveTo(256, 0);
    ctx.lineTo(256, 360);
    ctx.stroke();
    ctx.fillStyle = '#28324a';
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.font = `500 20px ${BODY_FONT}`;
    const rows = ['أبو سعيد — 24', 'رامو — 9', 'أم خالد — 31', 'سالم — 12'];
    rows.forEach((r, i) => ctx.fillText(r, 240, 62 + i * 26));
    ctx.fillText('الديون', 490, 32);
    return toTexture(c);
  });
}
