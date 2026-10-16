/** Domain constants shared by worker and client. Codes are English; labels live in i18n/pl.ts. */

export const ROLES = ['owner', 'manager', 'employee', 'terminal'] as const;
export type Role = (typeof ROLES)[number];

/** Permissions a manager can be granted per location (spec section B). */
export const PERMISSIONS = [
  'employees.view',
  'employees.manage',
  'training.assign',
  'results.view',
  'content.edit',
  'menu.edit',
  'tests.edit',
  'time.manage',
  'checklists.view',
  'wages.manage',
  'schedule.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const DEFAULT_MANAGER_PERMISSIONS: Permission[] = ['employees.view', 'training.assign', 'results.view'];

/**
 * A manager can be limited to some divisions (D43): stored next to permissions as "division:kitchen".
 * No division entries = all divisions. Used by Grafik (and later Rekrutacja).
 */
export const DIVISION_SCOPE_PREFIX = 'division:';

/** Positions. MVP trains only waiters; others exist for documents and future modules. */
export const POSITIONS = ['waiter', 'host', 'shift_manager', 'bartender', 'kitchen', 'hookah_master', 'call_center'] as const;
export type Position = (typeof POSITIONS)[number];

/** Change levels for every versioned item (spec section E). */
export const CHANGE_LEVELS = ['cosmetic', 'clarification', 'significant'] as const;
export type ChangeLevel = (typeof CHANGE_LEVELS)[number];

export const CONTENT_KINDS = ['lesson', 'service_book', 'regulation', 'sop', 'job_description', 'checklist'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const ALLERGEN_STATUSES = ['contains', 'not_contains', 'unconfirmed'] as const;
export type AllergenStatus = (typeof ALLERGEN_STATUSES)[number];

/** The 14 EU allergens (Regulation (EU) No 1169/2011, Annex II). */
export const EU_ALLERGENS = [
  { code: 'gluten', pl: 'Gluten' },
  { code: 'crustaceans', pl: 'Skorupiaki' },
  { code: 'eggs', pl: 'Jaja' },
  { code: 'fish', pl: 'Ryby' },
  { code: 'peanuts', pl: 'Orzeszki ziemne' },
  { code: 'soy', pl: 'Soja' },
  { code: 'milk', pl: 'Mleko' },
  { code: 'nuts', pl: 'Orzechy' },
  { code: 'celery', pl: 'Seler' },
  { code: 'mustard', pl: 'Gorczyca' },
  { code: 'sesame', pl: 'Sezam' },
  { code: 'sulphites', pl: 'Dwutlenek siarki i siarczyny' },
  { code: 'lupin', pl: 'Łubin' },
  { code: 'molluscs', pl: 'Mięczaki' },
] as const;

/** Security parameters (spec section G, decision D18). */
export const AUTH = {
  pinLength: 6,
  passwordMinLength: 10,
  maxFailedAttempts: 5,
  lockMinutesBase: 15,
  ipFailedLimit: 20,
  ipWindowMinutes: 15,
  employeeSessionDays: 30,
  staffSessionDays: 7,
  /** The time-clock phone stays signed in; leaving terminal mode needs its password (D35). */
  terminalSessionDays: 400,
  /** Wrong PINs in a row on one terminal before it pauses. */
  terminalFailLimit: 5,
  terminalPauseSeconds: 30,
} as const;

/** Data retention after deactivation (decision D19). */
export const RETENTION_YEARS_AFTER_DEACTIVATION = 2;
