import { and, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { z } from "zod";
import * as schema from "~/db/schema";
import { courses, notifications, users, UserRole } from "~/db/schema";
import {
  catalogue,
  catalogueEntry,
  ENTITY_TYPES,
  isNotificationKind,
  type NotificationCategory,
  type NotificationData,
  type NotificationKind,
} from "~/lib/notification-catalogue.server";

// ─── Notifications ───
// Raising Notifications (`notify`) and reading them back (the Notification
// Inbox read model). See GLOSSARY.md and docs/adr/0013. The kinds, and all
// of their wording, live in notification-catalogue.server.ts.
//
// Every function takes the database first, so tests can hand in an in-memory
// one, and `now`, so Today/Earlier and retention are deterministic.

export type Db = BetterSQLite3Database<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

/** Notifications older than this are pruned and never shown. */
export const RETENTION_DAYS = 90;

function retentionCutoff(now: Date): string {
  return new Date(
    now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}

// ─── Notification Recipients ───
// A declarative selector says who a Notification is for; `notify` resolves it.
// Adding a selector means adding one resolver here.

const recipientResolvers = {
  user: (_db: Queryable, userId: number): number[] => [userId],
  platformAdmins: (db: Queryable, _all: true): number[] =>
    db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, UserRole.Admin))
      .all()
      .map((row) => row.id),
  courseInstructor: (db: Queryable, courseId: number): number[] =>
    db
      .select({ id: courses.instructorId })
      .from(courses)
      .where(eq(courses.id, courseId))
      .all()
      .map((row) => row.id),
};

type Resolvers = typeof recipientResolvers;

/** e.g. `{ user: 7 }`, `{ platformAdmins: true }` or `{ courseInstructor: 3 }`. */
export type RecipientSelector = {
  [K in keyof Resolvers]: { [P in K]: Parameters<Resolvers[K]>[1] };
}[keyof Resolvers];

function resolveRecipients(db: Queryable, selector: RecipientSelector): number[] {
  const ids: number[] = [];
  for (const key of Object.keys(recipientResolvers) as (keyof Resolvers)[]) {
    if (!(key in selector)) continue;
    const resolve = recipientResolvers[key] as (
      db: Queryable,
      arg: unknown
    ) => number[];
    ids.push(...resolve(db, (selector as Record<string, unknown>)[key]));
  }
  return [...new Set(ids)];
}

// ─── Raising a Notification ───

/**
 * Raises a Notification of `kind` for everyone `recipients` selects, except
 * the actor, whose action raised it. Call it inside the business transaction
 * so a Notification exists exactly when the event does. Synchronous, with no
 * network I/O.
 *
 * `url` is the path the Notification links to, stored as a fact about where
 * the thing lives. Also prunes each Notification Recipient's Notifications
 * older than the retention period.
 */
export function notify(
  tx: Queryable,
  actorId: number,
  kind: NotificationKind,
  data: NotificationData,
  url: string,
  recipients: RecipientSelector,
  now: Date
): void {
  const entry = catalogueEntry(kind);

  if (!entry.object.includes(data.object.type)) {
    throw new Error(`${kind} cannot have a ${data.object.type} as its object`);
  }
  if (data.target && !entry.target?.includes(data.target.type)) {
    throw new Error(`${kind} cannot have a ${data.target.type} as its target`);
  }

  const recipientIds = resolveRecipients(tx, recipients).filter(
    (id) => id !== actorId
  );
  if (recipientIds.length === 0) return;

  const groupKey =
    entry.groupBy === "target" && data.target
      ? `${kind}:${data.target.type}:${data.target.id}`
      : null;

  tx.insert(notifications)
    .values(
      recipientIds.map((recipientId) => ({
        recipientId,
        actorId,
        kind,
        data,
        url,
        groupKey,
        createdAt: now.toISOString(),
      }))
    )
    .run();

  tx.delete(notifications)
    .where(
      and(
        inArray(notifications.recipientId, recipientIds),
        lt(notifications.createdAt, retentionCutoff(now))
      )
    )
    .run();
}

// ─── The Notification Inbox ───

const refSchema = z.object({
  type: z.enum(ENTITY_TYPES),
  id: z.number(),
  label: z.string(),
});

const notificationDataSchema = z.object({
  actor: refSchema,
  object: refSchema,
  target: refSchema.optional(),
  excerpt: z.string().optional(),
  change: z.object({ from: z.string(), to: z.string() }).optional(),
});

function parseData(raw: unknown): NotificationData | null {
  const parsed = notificationDataSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** One row as the Notification Recipient sees it. */
export type InboxRow = {
  /** The Notifications behind this row: one, or a whole group. */
  ids: number[];
  kind: NotificationKind;
  category: NotificationCategory;
  title: string;
  body: string | null;
  url: string;
  /** When the newest Notification behind the row was raised. */
  createdAt: string;
  read: boolean;
};

export type NotificationInbox = { today: InboxRow[]; earlier: InboxRow[] };

function localDay(when: Date): string {
  return `${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`;
}

function getInboxRows(
  db: Queryable,
  recipientId: number,
  now: Date
): InboxRow[] {
  const stored = db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        gte(notifications.createdAt, retentionCutoff(now))
      )
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .all();

  // Collapse rows that share a group key and a read state, keeping the
  // position of the newest one.
  const groups: {
    kind: NotificationKind;
    url: string;
    createdAt: string;
    read: boolean;
    ids: number[];
    data: NotificationData[];
  }[] = [];
  const groupIndex = new Map<string, number>();

  for (const notification of stored) {
    if (!isNotificationKind(notification.kind)) continue;
    const data = parseData(notification.data);
    if (!data) continue;

    const read = notification.readAt !== null;
    const key =
      notification.groupKey === null
        ? null
        : `${notification.groupKey}|${read ? "read" : "unread"}`;
    const existing = key === null ? undefined : groupIndex.get(key);

    if (existing !== undefined) {
      groups[existing].ids.push(notification.id);
      groups[existing].data.push(data);
      continue;
    }

    if (key !== null) groupIndex.set(key, groups.length);
    groups.push({
      kind: notification.kind,
      url: notification.url,
      createdAt: notification.createdAt,
      read,
      ids: [notification.id],
      data: [data],
    });
  }

  return groups.map((group) => {
    const entry = catalogueEntry(group.kind);
    const rendered = entry.render(group.data[0], group.data);
    return {
      ids: group.ids,
      kind: group.kind,
      category: entry.category,
      title: rendered.title,
      body: rendered.body ?? null,
      url: group.url,
      createdAt: group.createdAt,
      read: group.read,
    };
  });
}

/**
 * The Notification Recipient's Notifications from the retention period,
 * newest first, rendered and grouped, split into Today and Earlier.
 */
export function getNotificationInbox(
  db: Queryable,
  recipientId: number,
  now: Date
): NotificationInbox {
  const { today, earlier } = getNotificationInboxPage(db, recipientId, now, {
    limit: Infinity,
  });
  return { today, earlier };
}

function splitByDay(rows: InboxRow[], now: Date): NotificationInbox {
  const today = localDay(now);
  return {
    today: rows.filter((row) => localDay(new Date(row.createdAt)) === today),
    earlier: rows.filter((row) => localDay(new Date(row.createdAt)) !== today),
  };
}

/** The order the Notification Category filter chips appear in. */
export const NOTIFICATION_CATEGORIES = [
  "Money",
  "Courses",
  "Discussion",
  "Account",
] as const satisfies readonly NotificationCategory[];

/** How many inbox rows the Notification Inbox shows per "Load more". */
export const INBOX_PAGE_SIZE = 50;

export type InboxFilters = {
  /** Only rows of this Notification Category. Omit for All. */
  category?: NotificationCategory;
  /** Only unread rows. */
  unreadOnly?: boolean;
  /** At most this many rows, a grouped row counting once. Defaults to one page. */
  limit?: number;
};

export type NotificationInboxPage = NotificationInbox & {
  /** The Notification Categories the Notification Recipient has Notifications in, whatever the filters. */
  categories: NotificationCategory[];
  /** Whether rows beyond `limit` match the filters. */
  hasMore: boolean;
};

/**
 * The Notification Inbox, filtered and limited: the rows matching `filters`,
 * newest first, at most `limit` of them, split into Today and Earlier.
 */
export function getNotificationInboxPage(
  db: Queryable,
  recipientId: number,
  now: Date,
  filters: InboxFilters = {}
): NotificationInboxPage {
  const { category, unreadOnly = false, limit = INBOX_PAGE_SIZE } = filters;
  const rows = getInboxRows(db, recipientId, now);

  const present = new Set(rows.map((row) => row.category));
  const categories = NOTIFICATION_CATEGORIES.filter((c) => present.has(c));

  const matching = rows.filter(
    (row) =>
      (category === undefined || row.category === category) &&
      (!unreadOnly || !row.read)
  );

  return {
    ...splitByDay(matching.slice(0, limit), now),
    categories,
    hasMore: matching.length > limit,
  };
}

/** The number of unread inbox rows, as displayed: an unread group counts once. */
export function getUnreadNotificationCount(
  db: Queryable,
  recipientId: number,
  now: Date
): number {
  return getInboxRows(db, recipientId, now).filter((row) => !row.read).length;
}

// ─── Marking read ───

/**
 * Marks the Notifications behind an inbox row read. Ids that aren't the
 * Notification Recipient's own are ignored. Read Notifications stay read.
 */
export function markNotificationsRead(
  db: Queryable,
  recipientId: number,
  ids: number[],
  now: Date
): void {
  if (ids.length === 0) return;
  db.update(notifications)
    .set({ readAt: now.toISOString() })
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        inArray(notifications.id, ids),
        isNull(notifications.readAt)
      )
    )
    .run();
}

/**
 * Mark all as read: marks every one of the Notification Recipient's unread
 * Notifications in `category` read, or all of them when `category` is
 * omitted (All).
 */
export function markAllNotificationsRead(
  db: Queryable,
  recipientId: number,
  category: NotificationCategory | undefined,
  now: Date
): void {
  const conditions = [
    eq(notifications.recipientId, recipientId),
    isNull(notifications.readAt),
  ];
  if (category !== undefined) {
    const kinds = Object.entries(catalogue)
      .filter(([, entry]) => entry.category === category)
      .map(([kind]) => kind);
    if (kinds.length === 0) return;
    conditions.push(inArray(notifications.kind, kinds));
  }
  db.update(notifications)
    .set({ readAt: now.toISOString() })
    .where(and(...conditions))
    .run();
}

/**
 * Marks an inbox row read and returns where it links to, or null when none of
 * the ids are the Notification Recipient's own.
 */
export function openNotification(
  db: Db,
  recipientId: number,
  ids: number[],
  now: Date
): string | null {
  if (ids.length === 0) return null;
  return db.transaction((tx) => {
    const own = tx
      .select({ url: notifications.url })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          inArray(notifications.id, ids)
        )
      )
      .get();
    if (!own) return null;
    markNotificationsRead(tx, recipientId, ids, now);
    return own.url;
  });
}
