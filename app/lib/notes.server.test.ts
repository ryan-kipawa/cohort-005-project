import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { getNote, listNotes, MAX_NOTE_LENGTH, saveNote } from "./notes.server";

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

describe("saving a Note", () => {
  it("creates a Note with the body trimmed", () => {
    const result = saveNote(db, base.user.id, lessonIds[0], "  Rewatch 3:10  ", NOW);

    expect(result).toMatchObject({ ok: true });
    expect(getNote(db, base.user.id, lessonIds[0])).toMatchObject({
      body: "Rewatch 3:10",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it("keeps line breaks and Markdown characters exactly as typed", () => {
    saveNote(db, base.user.id, lessonIds[0], "# not a heading\n*not bold*", NOW);

    expect(getNote(db, base.user.id, lessonIds[0])?.body).toBe(
      "# not a heading\n*not bold*"
    );
  });

  it("replaces the body and moves the last-edited time on when saved again", () => {
    saveNote(db, base.user.id, lessonIds[0], "First draft", NOW);
    saveNote(db, base.user.id, lessonIds[0], "Second draft", minutesLater(5));

    expect(getNote(db, base.user.id, lessonIds[0])).toMatchObject({
      body: "Second draft",
      createdAt: NOW.toISOString(),
      updatedAt: minutesLater(5).toISOString(),
    });
    expect(listNotes(db, base.user.id)).toHaveLength(1);
  });

  it("refuses a second Note row at the database", () => {
    saveNote(db, base.user.id, lessonIds[0], "Mine", NOW);

    expect(() =>
      db
        .insert(schema.notes)
        .values({ userId: base.user.id, lessonId: lessonIds[0], body: "Dupe" })
        .run()
    ).toThrow(/UNIQUE/);
  });

  it(`accepts a Note of exactly ${MAX_NOTE_LENGTH} characters`, () => {
    const body = "a".repeat(MAX_NOTE_LENGTH);

    expect(saveNote(db, base.user.id, lessonIds[0], body, NOW)).toMatchObject({
      ok: true,
    });
    expect(getNote(db, base.user.id, lessonIds[0])?.body).toBe(body);
  });

  it(`refuses a Note over ${MAX_NOTE_LENGTH} characters with a message, without saving it`, () => {
    const result = saveNote(
      db,
      base.user.id,
      lessonIds[0],
      "a".repeat(MAX_NOTE_LENGTH + 1),
      NOW
    );

    expect(result).toEqual({
      ok: false,
      error: "A note must be 2,000 characters or fewer.",
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });

  it("refuses a Note that is only whitespace", () => {
    expect(saveNote(db, base.user.id, lessonIds[0], "   ", NOW)).toMatchObject({
      ok: false,
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });
});

describe("listing Notes", () => {
  it("lists only the Student's own Notes, most recently edited first, with Lesson and Course", () => {
    const other = addStudent("Ola");
    saveNote(db, base.user.id, lessonIds[0], "Oldest", NOW);
    saveNote(db, base.user.id, lessonIds[1], "Middle", minutesLater(1));
    saveNote(db, other.id, lessonIds[0], "Not mine", minutesLater(2));
    saveNote(db, base.user.id, lessonIds[0], "Oldest, edited", minutesLater(3));

    expect(listNotes(db, base.user.id)).toEqual([
      expect.objectContaining({
        body: "Oldest, edited",
        lessonId: lessonIds[0],
        lessonTitle: "Lesson 1",
        courseTitle: base.course.title,
        courseSlug: base.course.slug,
      }),
      expect.objectContaining({ body: "Middle", lessonId: lessonIds[1] }),
    ]);
  });
});

describe("deleting what a Note belongs to", () => {
  it("deletes the Lesson along with its Notes", () => {
    saveNote(db, base.user.id, lessonIds[0], "Mine", NOW);

    db.delete(schema.lessons).where(eq(schema.lessons.id, lessonIds[0])).run();

    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });

  it("deletes the Student along with their Notes", () => {
    const student = addStudent("Ola");
    saveNote(db, student.id, lessonIds[0], "Mine", NOW);

    db.delete(schema.users).where(eq(schema.users.id, student.id)).run();

    expect(listNotes(db, student.id)).toEqual([]);
  });
});
