/** Rekrutacja (2026-10-17): stages, phone format, RODO period — shared by worker and client. */

export const STAGES = ['new', 'interview', 'trial', 'hired', 'reserve', 'rejected'] as const;
export type Stage = (typeof STAGES)[number];
/** „Aktywni” on the list: everyone still in the process (and hired ones until the account is made) */
export const ACTIVE_STAGES: readonly Stage[] = ['new', 'interview', 'trial', 'hired'];

/** Statistics (2026-10-17): where candidates come from and why they are turned down. Labels in i18n/pl.ts. */
export const SOURCES = ['pracuj', 'olx', 'instagram', 'facebook', 'referral', 'website', 'walk_in', 'other'] as const;
export const REJECT_REASONS = ['experience', 'availability', 'salary', 'no_show', 'withdrew', 'fit', 'language', 'other'] as const;

export const DAY_MS = 86400_000;
/** RODO: data removed 6 months after the last change, warning 30 days before */
export const KEEP_DAYS = 183;
export const WARN_DAYS = 30;
export const deleteAtOf = (updatedAt: number) => updatedAt + KEEP_DAYS * DAY_MS;

/** Length of the calendar events */
export const INTERVIEW_MINUTES = 30;
export const TRIAL_MINUTES = 4 * 60;

export const CV_MAX_BYTES = 10 * 1024 * 1024;

/**
 * „601 234 567”, „0048 601-234-567”, „+48601234567” → „+48601234567”. Foreign numbers need their +code.
 * Returns null for something that is not a phone number.
 */
export function normalizePhone(input: string): string | null {
  let s = input.replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (/^\d{9}$/.test(s)) s = `+48${s}`;
  if (/^48\d{9}$/.test(s)) s = `+${s}`;
  return /^\+\d{8,15}$/.test(s) ? s : null;
}

/** Display while typing and in lists: „+48 601 234 567”; other countries: „+380 67 123 4567”-like groups of 3. */
export function formatPhone(input: string): string {
  const raw = input.replace(/[^\d+]/g, '');
  if (!raw) return '';
  let digits = raw.replace(/\+/g, '');
  const plus = raw.startsWith('+') || raw.startsWith('00');
  if (raw.startsWith('00')) digits = digits.slice(2);
  if (!plus) {
    // a Polish number typed without the prefix
    if (digits.length <= 9) return `+48 ${groups(digits)}`.trim();
    return groups(digits);
  }
  if (digits.startsWith('48')) return `+48 ${groups(digits.slice(2))}`.trim();
  const cc = digits.slice(0, Math.min(3, digits.length));
  return `+${cc}${digits.length > 3 ? ` ${groups(digits.slice(3))}` : ''}`;
}
const groups = (d: string) => d.replace(/(\d{3})(?=\d)/g, '$1 ').trim();

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 120;
