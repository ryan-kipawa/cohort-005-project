import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { courses, users } from "~/db/schema";
import type { EntityType, Ref } from "~/lib/notification-catalogue.server";

// ─── Notification Refs ───
// Building the facts a Notification stores (docs/adr/0013): the references in
// its `data`, and the excerpt it quotes. Every domain service that raises a
// Notification builds them here, so a missing label reads the same everywhere.

type Db = BetterSQLite3Database<typeof schema>;
type Queryable = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The label a user Ref gets when the user can't be found. */
const UNKNOWN_USER_LABEL = "Someone";

/** The label a Ref gets when its course can't be found. */
const UNKNOWN_COURSE_LABEL = "a course";

/** A Ref to a thing, labelled as it is when the Notification is raised. */
export function ref(type: EntityType, id: number, label: string): Ref {
  return { type, id, label };
}

/** A Ref to a user, labelled with their current name. */
export function userRef(db: Queryable, userId: number): Ref {
  const user = db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return ref("user", userId, user?.name ?? UNKNOWN_USER_LABEL);
}

/** A course's current title, for labelling Refs about it. */
export function courseLabel(db: Queryable, courseId: number): string {
  const course = db
    .select({ title: courses.title })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  return course?.title ?? UNKNOWN_COURSE_LABEL;
}

/** How much of a post or note a Notification quotes. */
export const EXCERPT_LENGTH = 140;

/** `text` on one line, cut to `EXCERPT_LENGTH` characters. */
export function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_LENGTH
    ? flat
    : `${flat.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`;
}
