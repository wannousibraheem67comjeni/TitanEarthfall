/**
 * Karak counter: each drink is a recipe of ingredients (with sugar counted), the
 * customer orders by name, and you build the cup.
 */
import type { Rng } from '../../core/rng';

export type Ingredient = 'water' | 'tea' | 'milk' | 'sugar' | 'cardamom' | 'saffron' | 'ginger' | 'mint' | 'coffee';

export const INGREDIENTS: { id: Ingredient; name: string; color: string; phrases: string[] }[] = [
  { id: 'water', name: 'ماء', color: '#9ec9e6', phrases: ['ماء', 'ماي', 'مي', 'مويه'] },
  { id: 'tea', name: 'شاي', color: '#6b3a1c', phrases: ['شاي', 'شاهي', 'ورق شاي'] },
  { id: 'milk', name: 'حليب', color: '#f3ead8', phrases: ['حليب', 'حليب مبخر', 'لبن'] },
  { id: 'sugar', name: 'سكر', color: '#ffffff', phrases: ['سكر', 'سكّر'] },
  { id: 'cardamom', name: 'هيل', color: '#7f9a4a', phrases: ['هيل', 'هال', 'حب هال'] },
  { id: 'saffron', name: 'زعفران', color: '#d9541e', phrases: ['زعفران'] },
  { id: 'ginger', name: 'زنجبيل', color: '#d8b46a', phrases: ['زنجبيل', 'زنجفيل'] },
  { id: 'mint', name: 'نعناع', color: '#3f9a52', phrases: ['نعناع', 'نعنع'] },
  { id: 'coffee', name: 'قهوة', color: '#3b2615', phrases: ['قهوه', 'بن', 'قهوة'] },
];

export type Recipe = Partial<Record<Ingredient, number>>;

export interface Drink {
  id: string;
  name: string;
  recipe: Recipe;
  minLevel: number;
}

export const DRINKS: Drink[] = [
  { id: 'karak', name: 'كرك', recipe: { water: 1, tea: 1, milk: 1, sugar: 1, cardamom: 1 }, minLevel: 1 },
  { id: 'milk_tea', name: 'شاي حليب', recipe: { water: 1, tea: 1, milk: 1, sugar: 1 }, minLevel: 1 },
  { id: 'red_tea', name: 'شاي أحمر', recipe: { water: 1, tea: 1, sugar: 1 }, minLevel: 1 },
  { id: 'karak_saffron', name: 'كرك زعفران', recipe: { water: 1, tea: 1, milk: 1, sugar: 1, cardamom: 1, saffron: 1 }, minLevel: 2 },
  { id: 'karak_nosugar', name: 'كرك بدون سكر', recipe: { water: 1, tea: 1, milk: 1, cardamom: 1 }, minLevel: 2 },
  { id: 'sulaimani', name: 'سليماني بالنعناع', recipe: { water: 1, tea: 1, mint: 1, sugar: 1 }, minLevel: 2 },
  { id: 'karak_extra', name: 'كرك زيادة سكر', recipe: { water: 1, tea: 1, milk: 1, sugar: 2, cardamom: 1 }, minLevel: 3 },
  { id: 'karak_ginger', name: 'كرك زنجبيل', recipe: { water: 1, tea: 1, milk: 1, sugar: 1, ginger: 1 }, minLevel: 3 },
  { id: 'gahwa', name: 'قهوة عربية', recipe: { water: 1, coffee: 1, cardamom: 1, saffron: 1 }, minLevel: 4 },
];

export function pickDrink(rng: Rng, level: number): Drink {
  const options = DRINKS.filter((d) => d.minLevel <= level);
  // Plain karak is what most people order.
  return rng.weighted(options, options.map((d) => (d.id === 'karak' ? 3 : 1)));
}

/** Number of ingredient units that differ between what was made and the recipe. */
export function recipeErrors(made: Recipe, want: Recipe): number {
  let errors = 0;
  for (const ing of INGREDIENTS) errors += Math.abs((made[ing.id] ?? 0) - (want[ing.id] ?? 0));
  return errors;
}

export function cupPay(base: number, errors: number, seconds: number, tipFactor: number): { wage: number; tip: number; verdict: 'perfect' | 'ok' | 'wrong' } {
  if (errors === 0) return { wage: base, tip: Math.round((seconds < 10 ? 4 : seconds < 18 ? 2 : 0) * tipFactor), verdict: 'perfect' };
  if (errors === 1) return { wage: Math.round(base * 0.5), tip: 0, verdict: 'ok' };
  return { wage: 0, tip: 0, verdict: 'wrong' };
}

export function recipeText(recipe: Recipe): string {
  return INGREDIENTS.filter((i) => recipe[i.id])
    .map((i) => (recipe[i.id]! > 1 ? `${i.name} ×${recipe[i.id]}` : i.name))
    .join(' + ');
}
