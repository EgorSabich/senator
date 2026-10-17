/** RODO for Rekrutacja: candidates are deleted 6 months after the last change (with their CV and comments). */
import type { Env } from '../env';
import { DAY_MS, KEEP_DAYS } from '../../shared/recruitment';
import { removeCandidates } from '../routes/recruitment';

export async function expireCandidates(env: Env, now: Date): Promise<number> {
  const limit = now.getTime() - KEEP_DAYS * DAY_MS;
  const { results } = await env.DB.prepare(`SELECT id, cv_key AS cvKey FROM candidates WHERE updated_at < ? LIMIT 200`).bind(limit).all<{ id: string; cvKey: string | null }>();
  await removeCandidates(env, results);
  return results.length;
}
