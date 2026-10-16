/**
 * Senator Academy — database schema (Cloudflare D1 / SQLite).
 * Spec: section F. Every location-owned table carries location_id; nothing is hard-deleted
 * (people are deactivated, content/menu archived). Timestamps are unix ms.
 */
import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core';

const id = () => text('id').primaryKey();
const createdAt = () =>
  integer('created_at', { mode: 'number' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);
const updatedAt = () =>
  integer('updated_at', { mode: 'number' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

/* ───────────── People & access ───────────── */

export const locations = sqliteTable('locations', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  /** Location details shown to staff (D38). */
  address: text('address'),
  phone: text('phone'),
  email: text('email'),
  /** JSON: { mon: "12:00–00:00", … } */
  openingHoursJson: text('opening_hours_json'),
  staffNote: text('staff_note'),
  /** Business day starts at this hour (time tracking, daily checklists). */
  dayStartHour: integer('day_start_hour').notNull().default(6),
  /** An open shift older than this many hours counts as "missing exit". */
  staleHours: integer('stale_hours').notNull().default(16),
  /** D40: terminal takes a small photo at every punch (kept 60 days). */
  punchPhoto: integer('punch_photo', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
});

export const users = sqliteTable(
  'users',
  {
    id: id(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    /** Normalized login (folded Polish, lower case). */
    login: text('login').notNull(),
    /** "terminal" = the time-clock account of a work phone (D35): it can only register time. */
    role: text('role', { enum: ['owner', 'manager', 'employee', 'terminal'] }).notNull(),
    status: text('status', { enum: ['active', 'inactive', 'anonymized'] }).notNull().default('active'),
    /** PBKDF2 hash of PIN (employee) or password (manager/owner); null after anonymization. */
    secretHash: text('secret_hash'),
    secretSalt: text('secret_salt'),
    secretKind: text('secret_kind', { enum: ['pin', 'password'] }).notNull(),
    mustChangeSecret: integer('must_change_secret', { mode: 'boolean' }).notNull().default(true),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockCount: integer('lock_count').notNull().default(0),
    lockedUntil: integer('locked_until'),
    lastLoginAt: integer('last_login_at'),
    deactivatedAt: integer('deactivated_at'),
    anonymizedAt: integer('anonymized_at'),
    /** HMAC(AUTH_SECRET, PIN) — finds the person on the time terminal by PIN alone (D35). Unique; null until set. */
    pinLookup: text('pin_lookup'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_login_uq').on(t.login),
    index('users_status_idx').on(t.status, t.deactivatedAt),
    uniqueIndex('users_pin_lookup_uq').on(t.pinLookup),
  ],
);

export const userLocations = sqliteTable(
  'user_locations',
  {
    id: id(),
    userId: text('user_id').notNull().references(() => users.id),
    locationId: text('location_id').notNull().references(() => locations.id),
    position: text('position').notNull(),
    startDate: text('start_date'), // ISO date YYYY-MM-DD
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('user_locations_uq').on(t.userId, t.locationId, t.position), index('user_locations_loc_idx').on(t.locationId)],
);

export const managerPermissions = sqliteTable(
  'manager_permissions',
  {
    userId: text('user_id').notNull().references(() => users.id),
    locationId: text('location_id').notNull().references(() => locations.id),
    permission: text('permission').notNull(),
    grantedBy: text('granted_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.locationId, t.permission] })],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: text('user_id').notNull().references(() => users.id),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: integer('last_seen_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    id: id(),
    login: text('login').notNull(),
    ipHash: text('ip_hash').notNull(),
    success: integer('success', { mode: 'boolean' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('login_attempts_ip_idx').on(t.ipHash, t.createdAt), index('login_attempts_login_idx').on(t.login, t.createdAt)],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: id(),
    actorId: text('actor_id').references(() => users.id),
    locationId: text('location_id').references(() => locations.id),
    action: text('action').notNull(), // e.g. user.create, content.publish
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_entity_idx').on(t.entityType, t.entityId), index('audit_created_idx').on(t.createdAt)],
);

/* ───────────── Content: lessons, Service Book, regulations & SOP ───────────── */

export const contentItems = sqliteTable(
  'content_items',
  {
    id: id(),
    /** null = shared standard visible in every location. */
    locationId: text('location_id').references(() => locations.id),
    kind: text('kind', {
      enum: ['lesson', 'service_book', 'regulation', 'sop', 'job_description', 'checklist'],
    }).notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    section: text('section'), // grouping inside Service Book / library
    status: text('status', { enum: ['draft', 'published', 'archived'] }).notNull().default('draft'),
    currentVersionId: text('current_version_id'),
    /** Documents: must be read to the end and confirmed. */
    requiresAck: integer('requires_ack', { mode: 'boolean' }).notNull().default(false),
    externalUrl: text('external_url'), // "Dokument zewnętrzny"
    attachmentKey: text('attachment_key'), // original PDF/DOCX in R2
    attachmentName: text('attachment_name'),
    /** Working copy edited in the admin panel; published as a new content_version. */
    draftTitle: text('draft_title'),
    draftBodyJson: text('draft_body_json'),
    draftUpdatedAt: integer('draft_updated_at'),
    draftUpdatedBy: text('draft_updated_by').references(() => users.id),
    importKey: text('import_key'), // set by the material import; re-import skips existing items
    sortOrder: integer('sort_order').notNull().default(0),
    /** Checklists only (D42): "individual" = everyone on shift does every item; "shared" = one item, one person (D36). */
    checklistMode: text('checklist_mode').notNull().default('individual'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('content_items_slug_uq').on(t.locationId, t.slug),
    index('content_items_kind_idx').on(t.kind, t.status),
    uniqueIndex('content_items_import_key_uq').on(t.locationId, t.importKey),
  ],
);

/** Uploaded photos and files in R2 (key = loc/<locationId|shared>/<kind>/<id>.<ext>). */
export const media = sqliteTable(
  'media',
  {
    id: id(),
    locationId: text('location_id').references(() => locations.id),
    key: text('key').notNull().unique(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    originalName: text('original_name'),
    uploadedBy: text('uploaded_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('media_loc_idx').on(t.locationId)],
);

/** Which positions see a document. No rows = everyone. */
export const contentItemPositions = sqliteTable(
  'content_item_positions',
  {
    contentItemId: text('content_item_id').notNull().references(() => contentItems.id),
    position: text('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.contentItemId, t.position] })],
);

export const contentVersions = sqliteTable(
  'content_versions',
  {
    id: id(),
    contentItemId: text('content_item_id').notNull().references(() => contentItems.id),
    versionNo: integer('version_no').notNull(),
    title: text('title').notNull(),
    bodyJson: text('body_json').notNull(), // TipTap JSON
    bodyText: text('body_text').notNull(), // plain text for search
    changeLevel: text('change_level', { enum: ['cosmetic', 'clarification', 'significant'] }).notNull(),
    changeNote: text('change_note'),
    authorId: text('author_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('content_versions_uq').on(t.contentItemId, t.versionNo)],
);

/** "Zapoznałem(-am) się" for lessons and documents — one row per user per version. */
export const contentAcknowledgements = sqliteTable(
  'content_acknowledgements',
  {
    id: id(),
    userId: text('user_id').notNull().references(() => users.id),
    contentItemId: text('content_item_id').notNull().references(() => contentItems.id),
    versionId: text('version_id').notNull().references(() => contentVersions.id),
    scrolledToEnd: integer('scrolled_to_end', { mode: 'boolean' }).notNull().default(false),
    acknowledgedAt: integer('acknowledged_at').notNull(),
  },
  (t) => [uniqueIndex('content_ack_uq').on(t.userId, t.versionId), index('content_ack_item_idx').on(t.contentItemId)],
);

export const programs = sqliteTable('programs', {
  id: id(),
  locationId: text('location_id').references(() => locations.id),
  name: text('name').notNull(),
  position: text('position').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
});

export const modules = sqliteTable('modules', {
  id: id(),
  programId: text('program_id').notNull().references(() => programs.id),
  title: text('title').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  isMandatory: integer('is_mandatory', { mode: 'boolean' }).notNull().default(true),
  unlockRule: text('unlock_rule', { enum: ['open', 'after_module', 'after_all_mandatory'] }).notNull().default('open'),
  unlockAfterModuleId: text('unlock_after_module_id'),
});

export const moduleItems = sqliteTable('module_items', {
  id: id(),
  moduleId: text('module_id').notNull().references(() => modules.id),
  itemType: text('item_type', { enum: ['content', 'test'] }).notNull(),
  contentItemId: text('content_item_id').references(() => contentItems.id),
  testId: text('test_id').references(() => tests.id),
  sortOrder: integer('sort_order').notNull().default(0),
  isMandatory: integer('is_mandatory', { mode: 'boolean' }).notNull().default(true),
});

export const assignments = sqliteTable(
  'assignments',
  {
    id: id(),
    locationId: text('location_id').notNull().references(() => locations.id),
    userId: text('user_id').notNull().references(() => users.id),
    kind: text('kind', { enum: ['program', 'module', 'content', 'test', 'task'] }).notNull(),
    refId: text('ref_id'),
    title: text('title'),
    description: text('description'),
    dueDate: text('due_date'),
    status: text('status', { enum: ['todo', 'in_progress', 'done', 'cancelled'] }).notNull().default('todo'),
    assignedBy: text('assigned_by').references(() => users.id),
    completedAt: integer('completed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('assignments_user_idx').on(t.userId, t.status), index('assignments_loc_idx').on(t.locationId)],
);

/* ───────────── Menu catalog ───────────── */

export const menuCategories = sqliteTable('menu_categories', {
  id: id(),
  locationId: text('location_id').notNull().references(() => locations.id),
  section: text('section', { enum: ['kitchen', 'bar'] }).notNull(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

/** One note per location and section, shown above the list (e.g. kitchen allergen remarks from the source sheet). */
export const menuSections = sqliteTable(
  'menu_sections',
  {
    locationId: text('location_id').notNull().references(() => locations.id),
    section: text('section', { enum: ['kitchen', 'bar'] }).notNull(),
    note: text('note'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.locationId, t.section] })],
);

export const menuItems = sqliteTable(
  'menu_items',
  {
    id: id(),
    locationId: text('location_id').notNull().references(() => locations.id),
    categoryId: text('category_id').notNull().references(() => menuCategories.id),
    nameGuest: text('name_guest').notNull(), // as in the guest menu (Choice OR)
    namePos: text('name_pos'), // as in GoPOS
    description: text('description'),
    ingredientsJson: text('ingredients_json'), // string[]
    keyIngredient: text('key_ingredient'),
    tasteTexture: text('taste_texture'),
    serving: text('serving'),
    howToSell: text('how_to_sell'),
    goodToKnow: text('good_to_know'),
    upsell: text('upsell'),
    guestQuestions: text('guest_questions'),
    alcoholNote: text('alcohol_note'),
    warnGuest: text('warn_guest'), // "Uprzedź gościa"
    dietNote: text('diet_note'), // remarks under "Dla kogo"
    importKey: text('import_key'), // "kitchen:<folded name>" — re-import skips existing items
    photoKey: text('photo_key'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    versionNo: integer('version_no').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('menu_items_loc_idx').on(t.locationId, t.categoryId),
    uniqueIndex('menu_items_import_key_unique').on(t.locationId, t.importKey),
  ],
);

export const menuItemVersions = sqliteTable('menu_item_versions', {
  id: id(),
  menuItemId: text('menu_item_id').notNull().references(() => menuItems.id),
  versionNo: integer('version_no').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  changeLevel: text('change_level', { enum: ['cosmetic', 'clarification', 'significant'] }).notNull(),
  changeNote: text('change_note'),
  authorId: text('author_id').references(() => users.id),
  createdAt: createdAt(),
});

export const allergens = sqliteTable('allergens', {
  id: text('id').primaryKey(), // code, e.g. "gluten"
  namePl: text('name_pl').notNull(),
  sortOrder: integer('sort_order').notNull(),
});

export const menuItemAllergens = sqliteTable(
  'menu_item_allergens',
  {
    menuItemId: text('menu_item_id').notNull().references(() => menuItems.id),
    allergenId: text('allergen_id').notNull().references(() => allergens.id),
    status: text('status', { enum: ['contains', 'not_contains', 'unconfirmed'] }).notNull().default('unconfirmed'),
    sourceNote: text('source_note'), // original wording from the import, e.g. "możliwe"
    confirmedBy: text('confirmed_by').references(() => users.id),
    confirmedAt: integer('confirmed_at'),
  },
  (t) => [primaryKey({ columns: [t.menuItemId, t.allergenId] })],
);

export const menuItemDiets = sqliteTable(
  'menu_item_diets',
  {
    menuItemId: text('menu_item_id').notNull().references(() => menuItems.id),
    diet: text('diet', { enum: ['vegetarian', 'vegan', 'gluten_free', 'dairy_free'] }).notNull(),
    status: text('status', { enum: ['yes', 'no', 'unconfirmed'] }).notNull().default('unconfirmed'),
    sourceNote: text('source_note'),
    confirmedBy: text('confirmed_by').references(() => users.id),
    confirmedAt: integer('confirmed_at'),
  },
  (t) => [primaryKey({ columns: [t.menuItemId, t.diet] })],
);

/* ───────────── Tests ───────────── */

export const tests = sqliteTable('tests', {
  id: id(),
  locationId: text('location_id').notNull().references(() => locations.id),
  title: text('title').notNull(),
  description: text('description'),
  passScore: integer('pass_score').notNull().default(80), // percent
  maxAttempts: integer('max_attempts'), // null = unlimited
  requireReviewBeforeRetake: integer('require_review_before_retake', { mode: 'boolean' }).notNull().default(false),
  questionCount: integer('question_count'), // null = all questions
  shuffle: integer('shuffle', { mode: 'boolean' }).notNull().default(true),
  status: text('status', { enum: ['draft', 'published', 'archived'] }).notNull().default('draft'),
  createdBy: text('created_by').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Materials to review before a retake (when requireReviewBeforeRetake). */
export const testReviewContent = sqliteTable(
  'test_review_content',
  {
    testId: text('test_id').notNull().references(() => tests.id),
    contentItemId: text('content_item_id').notNull().references(() => contentItems.id),
  },
  (t) => [primaryKey({ columns: [t.testId, t.contentItemId] })],
);

export const questions = sqliteTable(
  'questions',
  {
    id: id(),
    testId: text('test_id').notNull().references(() => tests.id),
    text: text('text').notNull(),
    topic: text('topic'),
    sourceType: text('source_type', { enum: ['menu_item', 'content_item'] }),
    sourceId: text('source_id'),
    imageKey: text('image_key'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [index('questions_test_idx').on(t.testId)],
);

export const answerOptions = sqliteTable('answer_options', {
  id: id(),
  questionId: text('question_id').notNull().references(() => questions.id),
  text: text('text').notNull(),
  isCorrect: integer('is_correct', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const testAttempts = sqliteTable(
  'test_attempts',
  {
    id: id(),
    testId: text('test_id').notNull().references(() => tests.id),
    userId: text('user_id').notNull().references(() => users.id),
    locationId: text('location_id').notNull().references(() => locations.id),
    attemptNo: integer('attempt_no').notNull(),
    status: text('status', { enum: ['in_progress', 'submitted', 'abandoned'] }).notNull().default('in_progress'),
    questionOrderJson: text('question_order_json').notNull(),
    startedAt: integer('started_at').notNull(),
    submittedAt: integer('submitted_at'),
    correctCount: integer('correct_count'),
    totalCount: integer('total_count'),
    scorePercent: integer('score_percent'),
    passed: integer('passed', { mode: 'boolean' }),
  },
  (t) => [uniqueIndex('test_attempts_uq').on(t.testId, t.userId, t.attemptNo), index('test_attempts_user_idx').on(t.userId)],
);

export const attemptAnswers = sqliteTable(
  'attempt_answers',
  {
    id: id(),
    attemptId: text('attempt_id').notNull().references(() => testAttempts.id),
    questionId: text('question_id').notNull().references(() => questions.id),
    selectedOptionId: text('selected_option_id'),
    isCorrect: integer('is_correct', { mode: 'boolean' }),
    /** Question text, options and correct id at answer time — edits never rewrite history. */
    snapshotJson: text('snapshot_json').notNull(),
    answeredAt: integer('answered_at'),
  },
  (t) => [uniqueIndex('attempt_answers_uq').on(t.attemptId, t.questionId)],
);

export const extraAttemptGrants = sqliteTable('extra_attempt_grants', {
  id: id(),
  testId: text('test_id').notNull().references(() => tests.id),
  userId: text('user_id').notNull().references(() => users.id),
  count: integer('count').notNull().default(1),
  grantedBy: text('granted_by').references(() => users.id),
  createdAt: createdAt(),
});

/* ───────────── Time tracking & daily checklists (D35, D36) ───────────── */

/** A work phone in time-clock mode. One terminal account per phone. */
export const terminals = sqliteTable(
  'terminals',
  {
    id: id(),
    locationId: text('location_id').notNull().references(() => locations.id),
    userId: text('user_id').notNull().references(() => users.id),
    name: text('name').notNull(),
    lastSeenAt: integer('last_seen_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('terminals_user_uq').on(t.userId), index('terminals_loc_idx').on(t.locationId)],
);

/** One shift: clock-in → clock-out. business_date = Warsaw date of clock-in, day starting 06:00. */
export const timeEntries = sqliteTable(
  'time_entries',
  {
    id: id(),
    locationId: text('location_id').notNull().references(() => locations.id),
    userId: text('user_id').notNull().references(() => users.id),
    businessDate: text('business_date').notNull(),
    clockInAt: integer('clock_in_at').notNull(),
    clockOutAt: integer('clock_out_at'),
    /** terminal | offline | manual */
    inSource: text('in_source').notNull(),
    outSource: text('out_source'),
    inTerminalId: text('in_terminal_id'),
    outTerminalId: text('out_terminal_id'),
    note: text('note'),
    editedBy: text('edited_by').references(() => users.id),
    editedAt: integer('edited_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('time_entries_loc_date_idx').on(t.locationId, t.businessDate),
    index('time_entries_user_idx').on(t.userId, t.clockInAt),
  ],
);

/** Every PIN entered on a terminal (also wrong ones); client_id makes offline re-sends idempotent. */
export const timePunches = sqliteTable(
  'time_punches',
  {
    id: id(),
    clientId: text('client_id').notNull(),
    terminalId: text('terminal_id').notNull().references(() => terminals.id),
    userId: text('user_id').references(() => users.id),
    at: integer('at').notNull(),
    offline: integer('offline', { mode: 'boolean' }).notNull().default(false),
    /** in | out | unknown_pin | rejected */
    outcome: text('outcome').notNull(),
    entryId: text('entry_id'),
    /** R2 key of the punch photo (D40), removed after 60 days. */
    photoKey: text('photo_key'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('time_punches_client_uq').on(t.terminalId, t.clientId), index('time_punches_user_idx').on(t.userId)],
);

/** Who did which checklist item on which business day. One item = one person. */
export const checklistMarks = sqliteTable(
  'checklist_marks',
  {
    id: id(),
    locationId: text('location_id').notNull().references(() => locations.id),
    contentItemId: text('content_item_id').notNull().references(() => contentItems.id),
    businessDate: text('business_date').notNull(),
    itemKey: text('item_key').notNull(),
    itemText: text('item_text').notNull(),
    section: text('section'),
    userId: text('user_id').notNull().references(() => users.id),
    markedAt: integer('marked_at').notNull(),
    /** '' for shared lists (one mark per item), the user id for individual ones (one mark per item and person). */
    ownerKey: text('owner_key').notNull().default(''),
  },
  (t) => [
    uniqueIndex('checklist_marks_owner_uq').on(t.contentItemId, t.businessDate, t.itemKey, t.ownerKey),
    index('checklist_marks_loc_date_idx').on(t.locationId, t.businessDate),
    index('checklist_marks_user_idx').on(t.userId, t.businessDate),
  ],
);

/** A checklist closed for a business day (items left unmarked are kept as "not done"). */
export const checklistDays = sqliteTable(
  'checklist_days',
  {
    contentItemId: text('content_item_id').notNull().references(() => contentItems.id),
    businessDate: text('business_date').notNull(),
    locationId: text('location_id').notNull().references(() => locations.id),
    closedBy: text('closed_by').references(() => users.id),
    closedAt: integer('closed_at').notNull(),
    doneCount: integer('done_count').notNull(),
    totalCount: integer('total_count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.contentItemId, t.businessDate] }), index('checklist_days_loc_idx').on(t.locationId, t.businessDate)],
);

/** Hourly rate of a person in a location, from a date (D37). Shift cost = hours × rate valid on its business day. */
export const payRates = sqliteTable(
  'pay_rates',
  {
    id: id(),
    userId: text('user_id').notNull().references(() => users.id),
    locationId: text('location_id').notNull().references(() => locations.id),
    /** grosze per hour (PLN × 100) */
    rateGrosze: integer('rate_grosze').notNull(),
    validFrom: text('valid_from').notNull(),
    createdBy: text('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('pay_rates_uq').on(t.userId, t.locationId, t.validFrom), index('pay_rates_loc_idx').on(t.locationId)],
);
