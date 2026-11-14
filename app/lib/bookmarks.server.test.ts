import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { isBookmarked, listBookmarks, toggleBookmark } from "./bookmarks.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function minutesLater(minutes: number) {
  return new Date(NOW.getTime() + minutes * 60_000);
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2, 3].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

describe("toggling a Bookmark", () => {
  it("bookmarks a Lesson that has no Bookmark", () => {
    expect(toggleBookmark(db, base.user.id, lessonIds[0], NOW)).toBe(true);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(true);
  });

  it("removes the Bookmark when toggled again", () => {
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);

    expect(toggleBookmark(db, base.user.id, lessonIds[0], NOW)).toBe(false);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(false);
  });

  it("never leaves a Student with two Bookmarks on one Lesson", () => {
    for (let i = 0; i < 3; i++) {
      toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    }

    expect(listBookmarks(db, base.user.id)).toHaveLength(1);
  });

  it("refuses a second Bookmark row at the database", () => {
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);

    expect(() =>
      db
        .insert(schema.bookmarks)
        .values({ userId: base.user.id, lessonId: lessonIds[0] })
        .run()
    ).toThrow(/UNIQUE/);
  });

  it("leaves another Student's Bookmark alone", () => {
    const other = addStudent("Ola");
    toggleBookmark(db, other.id, lessonIds[0], NOW);

    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);

    expect(isBookmarked(db, other.id, lessonIds[0])).toBe(true);
  });
});

describe("listing Bookmarks", () => {
  it("lists only the Student's own Bookmarks, newest first, with Lesson and Course", () => {
    const other = addStudent("Ola");
    toggleBookmark(db, base.user.id, lessonIds[1], NOW);
    toggleBookmark(db, other.id, lessonIds[0], minutesLater(1));
    toggleBookmark(db, base.user.id, lessonIds[2], minutesLater(2));

    expect(listBookmarks(db, base.user.id)).toEqual([
      expect.objectContaining({
        lessonId: lessonIds[2],
        lessonTitle: "Lesson 3",
        courseTitle: base.course.title,
        courseSlug: base.course.slug,
      }),
      expect.objectContaining({
        lessonId: lessonIds[1],
        lessonTitle: "Lesson 2",
        courseTitle: base.course.title,
      }),
    ]);
  });
});

describe("deleting what a Bookmark belongs to", () => {
  it("deletes the Lesson along with its Bookmarks", () => {
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);

    db.delete(schema.lessons).where(eq(schema.lessons.id, lessonIds[0])).run();

    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(false);
  });

  it("deletes the Student along with their Bookmarks", () => {
    const student = addStudent("Ola");
    toggleBookmark(db, student.id, lessonIds[0], NOW);

    db.delete(schema.users).where(eq(schema.users.id, student.id)).run();

    expect(listBookmarks(db, student.id)).toEqual([]);
  });
});
