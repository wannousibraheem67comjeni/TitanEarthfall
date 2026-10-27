/**
 * The street plan: where every place, door and walkable area is. Plain data, shared by
 * the 3D builder, collisions, the minimap, NPC directions and delivery routes.
 *
 * Axes: x runs along the main street (west → east), z across it (north is −z),
 * y is up. One unit is one metre. The road is z ∈ [−6, 6], sidewalks run to ±10,
 * shops line the north side and walled villas the south side.
 */

export type PlaceId =
  | 'home'
  | 'grandpa'
  | 'mosque'
  | 'grocery'
  | 'atm'
  | 'karak'
  | 'shawarma'
  | 'perfume'
  | 'barber'
  | 'electronics'
  | 'recycle'
  | 'busstop'
  | 'carwash'
  | 'umali'
  | 'hamad'
  | 'park'
  | 'stall'
  | 'alley';

export interface Place {
  id: PlaceId;
  name: string;
  /** Spoken directions, from the point of view of someone standing on the street. */
  hint: string;
  /** Where markers and directions point (a door, a gate, a counter). */
  x: number;
  z: number;
  /** Words people use for it. */
  phrases: string[];
  icon: string;
}

export const ROAD_HALF = 6;
export const SIDEWALK_OUTER = 10;
export const VILLA_WALL_Z = 14;
export const SHOP_FRONT_Z = -10;
export const BOUNDS = { minX: -124, maxX: 114, minZ: -38, maxZ: 98 };

export const PLACES: Place[] = [
  { id: 'home', name: 'بيتنا', hint: 'على الجهة الجنوبية من الشارع، البوابة الخشبية بين مجلس جدك وبيت أم علي', x: -70, z: 15, phrases: ['البيت', 'بيتنا', 'بيتي', 'الدار', 'بيتكم', 'home'], icon: '🏠' },
  { id: 'grandpa', name: 'مجلس جدي', hint: 'أول الشارع من جهة المسجد، تحت المظلة قدام بيت جدك', x: -104, z: 12, phrases: ['جدي', 'المجلس', 'مجلس', 'بيت جدي', 'جدك'], icon: '🪑' },
  { id: 'mosque', name: 'المسجد', hint: 'آخر الشارع من جهة الغرب، ما تقدر تفوته، المنارة باينة', x: -109, z: -11, phrases: ['المسجد', 'الجامع', 'مسجد', 'المنارة'], icon: '🕌' },
  { id: 'grocery', name: 'بقالة النور', hint: 'أول محل جنب المسجد', x: -82, z: -10, phrases: ['البقالة', 'بقالة', 'بقاله النور', 'السوبرماركت', 'الدكان', 'دكان', 'رحيم'], icon: '🛒' },
  { id: 'atm', name: 'الصراف الآلي', hint: 'بين البقالة ومحل الكرك', x: -69, z: -10, phrases: ['الصراف', 'صراف', 'البنك', 'atm', 'اسحب فلوس', 'حسابي'], icon: '🏧' },
  { id: 'karak', name: 'كرك الفريج', hint: 'بعد البقالة، اللي قدامه الكراسي البلاستيك', x: -57, z: -10, phrases: ['الكرك', 'كرك', 'الكافتيريا', 'كافتيريا', 'مقهى', 'القهوة', 'الشاي', 'ابو خالد'], icon: '☕' },
  { id: 'shawarma', name: 'شاورما الشام', hint: 'جنب محل الكرك، ريحة الشاورما بتدلك', x: -37, z: -10, phrases: ['المطعم', 'مطعم', 'الشاورما', 'شاورما', 'ابو احمد', 'توصيل'], icon: '🌯' },
  { id: 'perfume', name: 'عطور أبو سالم', hint: 'محل أبوك، بنص الشارع تقريباً جهة المحلات', x: -17, z: -10, phrases: ['العطور', 'محل العطور', 'عطر', 'عطور', 'دخون', 'بخور', 'محل ابوي', 'ابوي', 'ابوك'], icon: '🧴' },
  { id: 'barber', name: 'صالون الأناقة', hint: 'جنب محل العطور', x: 1, z: -10, phrases: ['الحلاق', 'حلاق', 'الصالون', 'صالون', 'ابو علاء'], icon: '💈' },
  { id: 'electronics', name: 'عالم الجوال', hint: 'بعد الصالون، الواجهة الزرقا', x: 19, z: -10, phrases: ['الجوالات', 'محل الجوالات', 'جوال', 'الكترونيات', 'لابتوب', 'مازن', 'تلفونات'], icon: '📱' },
  { id: 'recycle', name: 'آلة إعادة التدوير', hint: 'جنب موقف الباص بعد محل الجوالات', x: 33, z: -9.4, phrases: ['التدوير', 'اعادة التدوير', 'الة التدوير', 'العلب', 'القناني', 'recycle'], icon: '♻️' },
  { id: 'busstop', name: 'موقف الباص', hint: 'بعد محل الجوالات', x: 40, z: -9, phrases: ['الباص', 'موقف الباص', 'المحطة'], icon: '🚏' },
  { id: 'carwash', name: 'مغسلة البريق', hint: 'آخر الشارع من جهة الشرق، المظلة الكبيرة', x: 60, z: -11, phrases: ['المغسلة', 'مغسلة', 'غسيل السيارات', 'غسيل سيارات', 'حمدان', 'carwash'], icon: '🚿' },
  { id: 'umali', name: 'بيت أم علي', hint: 'بيت جيرانكم، قبل السكة', x: -37, z: 14, phrases: ['ام علي', 'بيت ام علي', 'علي', 'الجيران', 'جيرانا'], icon: '📚' },
  { id: 'hamad', name: 'بيت العم حمد', hint: 'بعد السكة، اللاندكروزر البيضا واقفة قدامه', x: 2, z: 14, phrases: ['العم حمد', 'حمد', 'عمي حمد', 'بيت حمد'], icon: '🚙' },
  { id: 'park', name: 'الحديقة', hint: 'آخر الشارع من جهة الشرق، على اليمين إذا كنت ماشي للمغسلة', x: 80, z: 15, phrases: ['الحديقة', 'حديقه', 'المنتزه', 'الملعب', 'البارك', 'park'], icon: '🌳' },
  { id: 'stall', name: 'البسطة', hint: 'عند مدخل الحديقة', x: 80, z: 11.6, phrases: ['البسطه', 'بسطه', 'بسطتي', 'الكشك', 'stall'], icon: '🧺' },
  { id: 'alley', name: 'السكة', hint: 'الشارع الفرعي بين بيت أم علي وبيت العم حمد', x: -17, z: 30, phrases: ['السكه', 'سكه', 'الفريج', 'الشارع الفرعي'], icon: '↪️' },
];

export const PLACE_BY_ID = new Map(PLACES.map((p) => [p.id, p]));

export function place(id: PlaceId): Place {
  return PLACE_BY_ID.get(id)!;
}

/** Doors that take food deliveries: where a customer comes out to the gate. */
export interface DeliveryDoor {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Direction the gate faces (radians around y), so the customer stands outside. */
  facing: number;
}

export const DELIVERY_DOORS: DeliveryDoor[] = [
  { id: 'd-umali', name: 'بيت أم علي', x: -37, z: 14, facing: Math.PI },
  { id: 'd-hamad', name: 'بيت العم حمد', x: 2, z: 14, facing: Math.PI },
  { id: 'd-21', name: 'فيلا 21', x: 32, z: 14, facing: Math.PI },
  { id: 'd-23', name: 'فيلا 23', x: 56, z: 14, facing: Math.PI },
  { id: 'd-30', name: 'فيلا 30 بالسكة', x: -22, z: 60, facing: Math.PI / 2 },
  { id: 'd-32', name: 'فيلا 32 بالسكة', x: -12, z: 60, facing: -Math.PI / 2 },
  { id: 'd-34', name: 'فيلا 34 آخر السكة', x: -17, z: 80, facing: Math.PI },
  { id: 'd-barber', name: 'صالون الأناقة', x: 1, z: -10, facing: 0 },
  { id: 'd-carwash', name: 'مغسلة البريق', x: 84, z: -12, facing: 0 },
];

/** Axis-aligned footprint on the ground plane. */
export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface ShopLot extends Rect {
  place: PlaceId | null;
  sign: string;
  signColor: string;
  signText: string;
  facade: string;
  awning: [string, string] | null;
  floors: number;
}

/** North side of the main street, west to east. Fronts sit on z = −10. */
export const SHOP_LOTS: ShopLot[] = [
  { minX: -92, maxX: -72, minZ: -24, maxZ: -10, place: 'grocery', sign: 'بقالة النور', signColor: '#1f6f4a', signText: '#fff6e0', facade: '#e8d9bd', awning: ['#2f8a57', '#f4efe3'], floors: 3 },
  { minX: -71, maxX: -67.5, minZ: -13, maxZ: -10.4, place: 'atm', sign: 'صراف', signColor: '#20406b', signText: '#ffffff', facade: '#cfd6dc', awning: null, floors: 1 },
  { minX: -66, maxX: -48, minZ: -24, maxZ: -10, place: 'karak', sign: 'كرك الفريج', signColor: '#8a3b12', signText: '#ffe7b0', facade: '#ead7b4', awning: ['#c0521e', '#f6e6c8'], floors: 3 },
  { minX: -46, maxX: -28, minZ: -24, maxZ: -10, place: 'shawarma', sign: 'شاورما الشام', signColor: '#b3261e', signText: '#fff4d6', facade: '#e3d2b0', awning: ['#b3261e', '#f2e8d5'], floors: 3 },
  { minX: -26, maxX: -8, minZ: -24, maxZ: -10, place: 'perfume', sign: 'عطور أبو سالم', signColor: '#3b2a1a', signText: '#e9c46a', facade: '#eadfca', awning: ['#5a3e2b', '#e9c46a'], floors: 3 },
  { minX: -6, maxX: 8, minZ: -24, maxZ: -10, place: 'barber', sign: 'صالون الأناقة', signColor: '#24324a', signText: '#ffffff', facade: '#dfe3e6', awning: ['#2b5aa8', '#ffffff'], floors: 2 },
  { minX: 10, maxX: 28, minZ: -24, maxZ: -10, place: 'electronics', sign: 'عالم الجوال', signColor: '#0d4fa3', signText: '#ffffff', facade: '#d8dde3', awning: null, floors: 4 },
];

/** The car-wash lot and its canopy. */
export const CARWASH = { minX: 50, maxX: 92, minZ: -34, maxZ: -10, bays: [{ x: 62, z: -21 }, { x: 77, z: -21 }], owner: { x: 58, z: -11.5 } };

/** South-side walled villas. The gate is a gap in the front wall at gateX. */
export interface VillaLot extends Rect {
  place: PlaceId | null;
  gateX: number;
  wall: string;
  house: string;
  trim: string;
  /** The family home has an open gate and a walkable courtyard. */
  open: boolean;
  number: string;
  windTower: boolean;
}

export const VILLA_LOTS: VillaLot[] = [
  { minX: -118, maxX: -90, minZ: 14, maxZ: 44, place: 'grandpa', gateX: -104, wall: '#d9c39a', house: '#e6d2ab', trim: '#8a6a3f', open: false, number: '3', windTower: true },
  { minX: -84, maxX: -56, minZ: 14, maxZ: 44, place: 'home', gateX: -70, wall: '#e9dcc2', house: '#f1e6cf', trim: '#7b5537', open: true, number: '7', windTower: false },
  { minX: -50, maxX: -22, minZ: 14, maxZ: 44, place: 'umali', gateX: -37, wall: '#e2d6c0', house: '#ece3d0', trim: '#4f6d7a', open: false, number: '11', windTower: false },
  { minX: -12, maxX: 16, minZ: 14, maxZ: 44, place: 'hamad', gateX: 2, wall: '#dccaa6', house: '#e8d8b6', trim: '#6b4e2e', open: false, number: '15', windTower: true },
  { minX: 20, maxX: 44, minZ: 14, maxZ: 44, place: null, gateX: 32, wall: '#e6dfd2', house: '#f3efe6', trim: '#5c6b5e', open: false, number: '21', windTower: false },
  { minX: 48, maxX: 64, minZ: 14, maxZ: 44, place: null, gateX: 56, wall: '#e0cfae', house: '#ebdcbd', trim: '#7a5c3c', open: false, number: '23', windTower: false },
];

/** Houses on the side alley (x ∈ [−22, −12]); gates open onto the alley. */
export const ALLEY = { minX: -22, maxX: -12, minZ: 14, maxZ: 80 };
export const ALLEY_HOUSES: (Rect & { gate: { x: number; z: number; axis: 'x' | 'z' }; number: string; wall: string; house: string })[] = [
  { minX: -46, maxX: -22, minZ: 48, maxZ: 72, gate: { x: -22, z: 60, axis: 'z' }, number: '30', wall: '#e4d4b4', house: '#efe2c6' },
  { minX: -12, maxX: 12, minZ: 48, maxZ: 72, gate: { x: -12, z: 60, axis: 'z' }, number: '32', wall: '#ddd2bf', house: '#ece6da' },
  { minX: -30, maxX: -4, minZ: 80, maxZ: 98, gate: { x: -17, z: 80, axis: 'x' }, number: '34', wall: '#d8c29b', house: '#e7d5b0' },
];

export const PARK = { minX: 68, maxX: 112, minZ: 14, maxZ: 52, gateMinX: 76, gateMaxX: 84 };
export const MOSQUE = { minX: -122, maxX: -96, minZ: -42, maxZ: -14 };

/** The family courtyard: plants to water, the desk with the laptop, mum's spot. */
export const HOME = {
  plants: [
    { x: -82, z: 17 },
    { x: -82, z: 22 },
    { x: -82, z: 27 },
    { x: -58, z: 17 },
    { x: -58, z: 22 },
    { x: -58, z: 27 },
  ],
  desk: { x: -61.5, z: 24.5 },
  door: { x: -70, z: 27.2 },
  mum: { x: -74, z: 21 },
  trashPickup: { x: -66, z: 27.1 },
  streetBin: { x: -63.5, z: 11.4 },
  spawn: { x: -70, z: 24, heading: Math.PI },
};

export const GRANDPA_SEAT = { x: -104, z: 12.2 };
export const STALL_SPOT = { x: 80, z: 11.6 };
export const BARBER_FLOOR = { x: 1, z: -12.5 };

/**
 * Walkable spine for pedestrians: points along both sidewalks and the alley that
 * walkers move between. Kept inside the open areas so they never need pathfinding.
 */
export function pedestrianRoutes(): { x: number; z: number }[][] {
  const north: { x: number; z: number }[] = [];
  const south: { x: number; z: number }[] = [];
  for (let x = -118; x <= 104; x += 13) {
    north.push({ x, z: -8.2 });
    south.push({ x, z: 8.2 });
  }
  const alley = [
    { x: -17, z: 9 },
    { x: -17, z: 30 },
    { x: -17, z: 55 },
    { x: -17, z: 76 },
  ];
  const park = [
    { x: 80, z: 9 },
    { x: 80, z: 20 },
    { x: 92, z: 32 },
    { x: 100, z: 44 },
    { x: 76, z: 40 },
  ];
  return [north, south, alley, park];
}

export function distance2D(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}
