/**
 * Menu catalog: field list, statuses and the import bundle format — shared by server and panel.
 * Decisions D1, D5, D10, D11.
 */
import { ALLERGEN_STATUSES, EU_ALLERGENS, type AllergenStatus } from './constants';

export const MENU_SECTIONS = ['kitchen', 'bar'] as const;
export type MenuSection = (typeof MENU_SECTIONS)[number];

export const DIETS = ['vegetarian', 'vegan', 'gluten_free', 'dairy_free'] as const;
export type Diet = (typeof DIETS)[number];
export const DIET_STATUSES = ['yes', 'no', 'unconfirmed'] as const;
export type DietStatus = (typeof DIET_STATUSES)[number];

/** Text fields of a menu item: API name → DB column and max length. Order = order on the card. */
export const MENU_TEXT_FIELDS = {
  nameGuest: { column: 'name_guest', max: 200 },
  namePos: { column: 'name_pos', max: 200 },
  description: { column: 'description', max: 4000 },
  keyIngredient: { column: 'key_ingredient', max: 500 },
  tasteTexture: { column: 'taste_texture', max: 1500 },
  serving: { column: 'serving', max: 500 },
  howToSell: { column: 'how_to_sell', max: 2500 },
  goodToKnow: { column: 'good_to_know', max: 2500 },
  upsell: { column: 'upsell', max: 1500 },
  guestQuestions: { column: 'guest_questions', max: 4000 },
  warnGuest: { column: 'warn_guest', max: 1500 },
  alcoholNote: { column: 'alcohol_note', max: 300 },
  dietNote: { column: 'diet_note', max: 1500 },
} as const;
export type MenuTextField = keyof typeof MENU_TEXT_FIELDS;
export const MENU_TEXT_FIELD_NAMES = Object.keys(MENU_TEXT_FIELDS) as MenuTextField[];

export const INGREDIENTS_MAX = 60;
export const INGREDIENT_MAX_LEN = 200;

export type MenuTexts = Record<MenuTextField, string | null>;

/** Normalizes one text field: trimmed, CRLF → LF, empty → null; too long → error code. */
export function cleanMenuText(field: MenuTextField, v: unknown): string | null | 'too_long' | 'invalid' {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return 'invalid';
  const t = v.replace(/\r\n?/g, '\n').trim();
  if (!t) return null;
  if (t.length > MENU_TEXT_FIELDS[field].max) return 'too_long';
  return t;
}

export function cleanIngredients(v: unknown): string[] | 'invalid' {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v) || v.length > INGREDIENTS_MAX) return 'invalid';
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') return 'invalid';
    const t = x.replace(/\s+/g, ' ').trim();
    if (t.length > INGREDIENT_MAX_LEN) return 'invalid';
    if (t) out.push(t);
  }
  return out;
}

export const ALLERGEN_CODES = EU_ALLERGENS.map((a) => a.code);

export function isAllergenStatus(v: unknown): v is AllergenStatus {
  return typeof v === 'string' && (ALLERGEN_STATUSES as readonly string[]).includes(v);
}
export function isDietStatus(v: unknown): v is DietStatus {
  return typeof v === 'string' && (DIET_STATUSES as readonly string[]).includes(v);
}

/* ───────── Import bundle (scripts/menu/build_menu_bundle.py) ───────── */

export const BUNDLE_FORMAT = 'senator-menu-bundle';
export const IMPORT_CHUNK = 8;

export interface BundleItem extends Partial<MenuTexts> {
  importKey: string;
  section: MenuSection;
  category: string;
  sortOrder?: number;
  nameGuest: string;
  ingredients?: string[];
  allergens?: Record<string, { status: AllergenStatus; source: string | null }>;
  diets?: Record<string, { status: DietStatus; source: string | null }>;
  photo?: { contentType: string; data: string } | null;
}

export interface MenuBundle {
  format: typeof BUNDLE_FORMAT;
  version: 1;
  createdAt?: string;
  sources?: Record<string, string>;
  sections?: Partial<Record<MenuSection, { note: string | null }>>;
  categories: { section: MenuSection; name: string; sortOrder: number }[];
  items: BundleItem[];
  issues?: string[];
}

/** Light structural check before the panel sends a bundle to the server (server validates again). */
export function checkBundle(v: unknown): MenuBundle | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as MenuBundle;
  if (b.format !== BUNDLE_FORMAT || b.version !== 1 || !Array.isArray(b.items) || !Array.isArray(b.categories)) return null;
  return b;
}

/** Text used for the search index of a menu item. */
export function menuSearchBody(t: Partial<MenuTexts>, ingredients: string[]): string {
  return [
    t.namePos,
    ingredients.join(', '),
    t.description,
    t.keyIngredient,
    t.tasteTexture,
    t.serving,
    t.howToSell,
    t.goodToKnow,
    t.upsell,
    t.guestQuestions,
    t.warnGuest,
  ]
    .filter(Boolean)
    .join('\n');
}
