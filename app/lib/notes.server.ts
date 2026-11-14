import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "~/db/schema";
import { courses, lessons, modules, notes } from "~/db/schema";

// ─── Notes ───
// A Note is a Student's own plain-text writing about a Lesson, one per Student
// per Lesson (the unique index enforces it). It is private to the Student who
// wrote it: nothing outside their own Lesson page and Saved page reads it, and
// no Instructor or Platform Admin view may. See GLOSSARY.md.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Content access is the caller's job: the Lesson action checks it before
// calling in.

export type Db = BetterSQLite3Database<typeof schema>;

export const MAX_NOTE_LENGTH = 2000;

export const noteBodySchema = z
  .string()
  .trim()
  .min(1, "Write something before saving your note.")
  .max(
    MAX_NOTE_LENGTH,
    `A note must be ${MAX_NOTE_LENGTH.toLocaleString("en")} characters or fewer.`
  );

type Note = typeof notes.$inferSelect;

export type SaveNoteResult =
  | { ok: true; note: Note }
  | { ok: false; error: string };

export function getNote(db: Db, studentId: number, lessonId: number) {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, studentId), eq(notes.lessonId, lessonId)))
    .get();
}

/**
 * Creates the Student's Note on the Lesson, or replaces its body and moves its
 * "last edited" time on. `createdAt` never changes on a re-save. A body that
 * is empty or over the cap once trimmed is refused, never truncated.
 */
export function saveNote(
  db: Db,
  studentId: number,
  lessonId: number,
  body: string,
  now: Date
): SaveNoteResult {
  const parsed = noteBodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const at = now.toISOString();
  const note = db
    .insert(notes)
    .values({
      userId: studentId,
      lessonId,
      body: parsed.data,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: parsed.data, updatedAt: at },
    })
    .returning()
    .get();

  return { ok: true, note };
}

/**
 * The Student's Notes, most recently edited first, each with the Lesson and
 * Course it belongs to.
 */
export function listNotes(db: Db, studentId: number) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(notes)
    .innerJoin(lessons, eq(notes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(notes.userId, studentId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}
