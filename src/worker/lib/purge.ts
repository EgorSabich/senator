/**
 * Permanent deletion (decision D30). Only for archived / deactivated records — the route checks that.
 * Every statement list runs in one D1 batch (one transaction): either everything goes, or nothing.
 * Nightly backups in R2 still hold the data until they expire (see docs/SECURITY.md).
 */
import { unindexStatement } from './search';

/** A person and everything that is theirs. Where they were only the actor (author, grantor), the link is cleared. */
export function purgeUserStatements(db: D1Database, userId: string, login: string): D1PreparedStatement[] {
  const s = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args);
  return [
    // their own data
    s(`DELETE FROM attempt_answers WHERE attempt_id IN (SELECT id FROM test_attempts WHERE user_id = ?)`, userId),
    s(`DELETE FROM test_attempts WHERE user_id = ?`, userId),
    s(`DELETE FROM content_acknowledgements WHERE user_id = ?`, userId),
    s(`DELETE FROM extra_attempt_grants WHERE user_id = ?`, userId),
    s(`DELETE FROM assignments WHERE user_id = ?`, userId),
    s(`DELETE FROM manager_permissions WHERE user_id = ?`, userId),
    s(`DELETE FROM user_locations WHERE user_id = ?`, userId),
    s(`DELETE FROM sessions WHERE user_id = ?`, userId),
    s(`DELETE FROM push_subscriptions WHERE user_id = ?`, userId),
    s(`DELETE FROM push_log WHERE user_id = ?`, userId),
    s(`DELETE FROM calendar_feeds WHERE user_id = ?`, userId),
    s(`UPDATE notification_rules SET updated_by = NULL WHERE updated_by = ?`, userId),
    s(`UPDATE custom_notifications SET created_by = NULL WHERE created_by = ?`, userId),
    s(`UPDATE attendance_excuses SET created_by = NULL WHERE created_by = ?`, userId),
    s(`UPDATE candidates SET created_by = NULL WHERE created_by = ?`, userId),
    s(`UPDATE candidates SET hired_user_id = NULL WHERE hired_user_id = ?`, userId),
    s(`UPDATE candidate_comments SET author_id = NULL WHERE author_id = ?`, userId),
    s(`DELETE FROM login_attempts WHERE login = ?`, login),
    s(`UPDATE time_punches SET entry_id = NULL WHERE entry_id IN (SELECT id FROM time_entries WHERE user_id = ?)`, userId),
    s(`DELETE FROM time_entries WHERE user_id = ?`, userId),
    s(`DELETE FROM time_punches WHERE user_id = ?`, userId),
    s(`DELETE FROM checklist_marks WHERE user_id = ?`, userId),
    s(`DELETE FROM pay_rates WHERE user_id = ?`, userId),
    s(`DELETE FROM schedule_shifts WHERE user_id = ?`, userId),
    s(`DELETE FROM unavailability WHERE user_id = ?`, userId),
    s(`DELETE FROM attendance_excuses WHERE user_id = ?`, userId),
    // links where they were the actor
    s(`UPDATE extra_attempt_grants SET granted_by = NULL WHERE granted_by = ?`, userId),
    s(`UPDATE assignments SET assigned_by = NULL WHERE assigned_by = ?`, userId),
    s(`UPDATE manager_permissions SET granted_by = NULL WHERE granted_by = ?`, userId),
    s(`UPDATE content_versions SET author_id = NULL WHERE author_id = ?`, userId),
    s(`UPDATE content_items SET draft_updated_by = NULL WHERE draft_updated_by = ?`, userId),
    s(`UPDATE menu_item_versions SET author_id = NULL WHERE author_id = ?`, userId),
    s(`UPDATE menu_item_allergens SET confirmed_by = NULL WHERE confirmed_by = ?`, userId),
    s(`UPDATE menu_item_diets SET confirmed_by = NULL WHERE confirmed_by = ?`, userId),
    s(`UPDATE tests SET created_by = NULL WHERE created_by = ?`, userId),
    s(`UPDATE media SET uploaded_by = NULL WHERE uploaded_by = ?`, userId),
    s(`UPDATE time_entries SET edited_by = NULL WHERE edited_by = ?`, userId),
    s(`UPDATE pay_rates SET created_by = NULL WHERE created_by = ?`, userId),
    s(`UPDATE schedule_shifts SET created_by = NULL WHERE created_by = ?`, userId),
    s(`UPDATE unavailability SET set_by = NULL WHERE set_by = ?`, userId),
    s(`UPDATE checklist_days SET closed_by = NULL WHERE closed_by = ?`, userId),
    s(`UPDATE knowledge_tabs SET created_by = NULL WHERE created_by = ?`, userId),
    // audit log: keep what happened, drop who it was
    s(`UPDATE audit_log SET actor_id = NULL WHERE actor_id = ?`, userId),
    s(`UPDATE audit_log SET before_json = NULL, after_json = NULL WHERE entity_type = 'user' AND entity_id = ?`, userId),
    s(`DELETE FROM users WHERE id = ?`, userId),
  ];
}

/** A menu item with its allergens, diets, versions and search entry. The photo file stays in storage. */
export function purgeMenuItemStatements(db: D1Database, itemId: string): D1PreparedStatement[] {
  return [
    db.prepare(`DELETE FROM menu_item_allergens WHERE menu_item_id = ?`).bind(itemId),
    db.prepare(`DELETE FROM menu_item_diets WHERE menu_item_id = ?`).bind(itemId),
    db.prepare(`DELETE FROM menu_item_versions WHERE menu_item_id = ?`).bind(itemId),
    unindexStatement(db, 'menu_item', itemId),
    db.prepare(`DELETE FROM menu_items WHERE id = ?`).bind(itemId),
  ];
}

/** A material with its versions, positions, places in programs, review links and everyone's acknowledgements. */
export function purgeContentStatements(db: D1Database, itemId: string): D1PreparedStatement[] {
  return [
    db.prepare(`DELETE FROM content_acknowledgements WHERE content_item_id = ?`).bind(itemId),
    db.prepare(`DELETE FROM checklist_marks WHERE content_item_id = ?`).bind(itemId),
    db.prepare(`DELETE FROM checklist_days WHERE content_item_id = ?`).bind(itemId),
    db.prepare(`DELETE FROM module_items WHERE content_item_id = ?`).bind(itemId),
    db.prepare(`DELETE FROM test_review_content WHERE content_item_id = ?`).bind(itemId),
    db.prepare(`DELETE FROM assignments WHERE ref_id = ?`).bind(itemId),
    db.prepare(`DELETE FROM content_item_positions WHERE content_item_id = ?`).bind(itemId),
    db.prepare(`UPDATE content_items SET current_version_id = NULL WHERE id = ?`).bind(itemId),
    db.prepare(`DELETE FROM content_versions WHERE content_item_id = ?`).bind(itemId),
    unindexStatement(db, 'content', itemId),
    db.prepare(`DELETE FROM content_items WHERE id = ?`).bind(itemId),
  ];
}

/** "Type the name to confirm": letter case and extra spaces do not matter. */
export function confirmMatches(typed: unknown, expected: string): boolean {
  const norm = (v: string) => v.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pl');
  return typeof typed === 'string' && norm(typed) === norm(expected);
}
