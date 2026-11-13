import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { getNotificationInbox } from "./notifications.server";
import {
  deleteLessonThreadPost,
  editLessonThreadPost,
  replyToLessonThread,
  startLessonThread,
} from "./lesson-threads.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let platformAdmin: typeof schema.users.$inferSelect;
let lesson: typeof schema.lessons.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  platformAdmin = db
    .insert(schema.users)
    .values({ name: "Pat Admin", email: "pat@example.com", role: UserRole.Admin })
    .returning()
    .get();
  const mod = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  lesson = db
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Closures", position: 1 })
    .returning()
    .get();
});

function lessonUrl() {
  return `/courses/test-course/lessons/${lesson.id}`;
}

function inbox(userId: number) {
  const { today, earlier } = getNotificationInbox(db, userId, NOW);
  return [...today, ...earlier];
}

describe("lesson_thread_started", () => {
  it("tells the course's Instructor, with an excerpt of the opening post, and links to the lesson", () => {
    startLessonThread(db, base.user.id, lesson.id, "Why does the counter keep its value?", NOW);

    expect(inbox(base.instructor.id)).toEqual([
      expect.objectContaining({
        kind: "lesson_thread_started",
        category: "Discussion",
        title: "Test User started a Lesson Thread on Closures",
        body: "Why does the counter keep its value?",
        url: lessonUrl(),
        read: false,
      }),
    ]);
  });

  it("does not tell Platform Admins", () => {
    startLessonThread(db, base.user.id, lesson.id, "A question", NOW);

    expect(inbox(platformAdmin.id)).toEqual([]);
  });

  it("raises nothing when a Platform Admin starts the Lesson Thread", () => {
    startLessonThread(db, platformAdmin.id, lesson.id, "A note for everyone", NOW);

    expect(inbox(base.instructor.id)).toEqual([]);
  });

  it("raises nothing when the course's Instructor starts the Lesson Thread", () => {
    startLessonThread(db, base.instructor.id, lesson.id, "Welcome to the lesson", NOW);

    expect(inbox(base.instructor.id)).toEqual([]);
    expect(inbox(platformAdmin.id)).toEqual([]);
  });
});

function addStudent(name: string, email: string) {
  return db
    .insert(schema.users)
    .values({ name, email, role: UserRole.Student })
    .returning()
    .get();
}

describe("lesson_thread_reply", () => {
  it("tells whoever started the Lesson Thread when another Student replies", () => {
    const other = addStudent("Olive Other", "olive@example.com");
    const thread = startLessonThread(db, base.user.id, lesson.id, "A question", NOW);

    replyToLessonThread(db, other.id, lesson.id, thread.id, "Me too, I wondered that", NOW);

    expect(inbox(base.user.id)).toEqual([
      expect.objectContaining({
        kind: "lesson_thread_reply",
        category: "Discussion",
        title: "Olive Other replied to your Lesson Thread on Closures",
        body: "Me too, I wondered that",
        url: lessonUrl(),
      }),
    ]);
  });

  it("raises nothing when you reply in your own Lesson Thread", () => {
    const thread = startLessonThread(db, base.user.id, lesson.id, "A question", NOW);

    replyToLessonThread(db, base.user.id, lesson.id, thread.id, "Never mind, solved it", NOW);

    expect(inbox(base.user.id)).toEqual([]);
  });

  it("does not tell other people who replied", () => {
    const olive = addStudent("Olive Other", "olive@example.com");
    const sam = addStudent("Sam Third", "sam@example.com");
    const thread = startLessonThread(db, base.user.id, lesson.id, "A question", NOW);
    replyToLessonThread(db, olive.id, lesson.id, thread.id, "Same here", NOW);

    replyToLessonThread(db, sam.id, lesson.id, thread.id, "And me", NOW);

    expect(inbox(olive.id)).toEqual([]);
    expect(inbox(base.user.id).map((row) => row.title)).toEqual([
      "Sam Third replied to your Lesson Thread on Closures",
      "Olive Other replied to your Lesson Thread on Closures",
    ]);
  });
});

describe("lesson_thread_answer", () => {
  it("is what whoever started the Lesson Thread gets when the course's Instructor replies", () => {
    const thread = startLessonThread(db, base.user.id, lesson.id, "A question", NOW);

    replyToLessonThread(db, base.instructor.id, lesson.id, thread.id, "Closures capture variables.", NOW);

    expect(inbox(base.user.id)).toEqual([
      expect.objectContaining({
        kind: "lesson_thread_answer",
        category: "Discussion",
        title: "Test Instructor answered your Lesson Thread on Closures",
        body: "Closures capture variables.",
        url: lessonUrl(),
      }),
    ]);
  });

  it("is what they get when a Platform Admin replies", () => {
    const thread = startLessonThread(db, base.user.id, lesson.id, "A question", NOW);

    replyToLessonThread(db, platformAdmin.id, lesson.id, thread.id, "See the docs.", NOW);

    expect(inbox(base.user.id).map((row) => [row.kind, row.title])).toEqual([
      ["lesson_thread_answer", "Pat Admin answered your Lesson Thread on Closures"],
    ]);
  });
});

describe("post_deleted", () => {
  it("tells the author when the course's Instructor deletes their opening post, quoting what they wrote", () => {
    const thread = startLessonThread(db, base.user.id, lesson.id, "Buy cheap watches here", NOW);

    deleteLessonThreadPost(db, base.instructor.id, thread.id, NOW);

    expect(inbox(base.user.id)).toEqual([
      expect.objectContaining({
        kind: "post_deleted",
        category: "Discussion",
        title: "Test Instructor deleted your post on Closures",
        body: "Buy cheap watches here",
        url: lessonUrl(),
      }),
    ]);
  });

  it("tells the author when a Platform Admin deletes their reply", () => {
    const olive = addStudent("Olive Other", "olive@example.com");
    const thread = startLessonThread(db, base.user.id, lesson.id, "A question", NOW);
    const reply = replyToLessonThread(db, olive.id, lesson.id, thread.id, "Off-topic rant", NOW);

    deleteLessonThreadPost(db, platformAdmin.id, reply.id, NOW);

    expect(inbox(olive.id).map((row) => [row.title, row.body])).toEqual([
      ["Pat Admin deleted your post on Closures", "Off-topic rant"],
    ]);
  });

  it("raises nothing when you delete your own post", () => {
    const thread = startLessonThread(db, base.user.id, lesson.id, "A question", NOW);

    deleteLessonThreadPost(db, base.user.id, thread.id, NOW);

    expect(inbox(base.user.id)).toEqual([]);
  });
});

describe("editing a post", () => {
  it("raises nothing, for an opening post or a reply", () => {
    const olive = addStudent("Olive Other", "olive@example.com");
    const thread = startLessonThread(db, base.user.id, lesson.id, "A question", NOW);
    const reply = replyToLessonThread(db, olive.id, lesson.id, thread.id, "An answer", NOW);
    const before = { starter: inbox(base.user.id), instructor: inbox(base.instructor.id) };

    editLessonThreadPost(db, base.user.id, thread.id, "A clearer question", NOW);
    editLessonThreadPost(db, olive.id, reply.id, "A better answer", NOW);

    expect(inbox(base.user.id)).toEqual(before.starter);
    expect(inbox(base.instructor.id)).toEqual(before.instructor);
    expect(inbox(olive.id)).toEqual([]);
  });
});
