import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";

// lesson-viewer reads the shared `db`, so point it at a fresh test database.
let db: TestDb;
vi.mock("~/db", () => ({
  get db() {
    return db;
  },
}));

const { getQuizInLesson } = await import("../quiz.server");

// ─── Fixtures ───
// lesson-viewer only reads quizzes, so rows go in directly.

function addLesson(moduleId: number, title: string) {
  return db
    .insert(schema.lessons)
    .values({ moduleId, title, position: 1 })
    .returning()
    .get();
}

function addQuiz(lessonId: number) {
  return db
    .insert(schema.quizzes)
    .values({ lessonId, title: "Check yourself", passingScore: 0.7 })
    .returning()
    .get();
}

let lessonId: number;
let otherLessonId: number;

beforeEach(() => {
  db = createTestDb();
  const { course } = seedBaseData(db);
  const mod = db
    .insert(schema.modules)
    .values({ courseId: course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  lessonId = addLesson(mod.id, "Types").id;
  otherLessonId = addLesson(mod.id, "Generics").id;
});

describe("getQuizInLesson", () => {
  it("returns the quiz when it belongs to the lesson", () => {
    const quiz = addQuiz(lessonId);

    expect(getQuizInLesson(quiz.id, lessonId)).toEqual(quiz);
  });

  it("does not return a quiz that belongs to another lesson", () => {
    const quiz = addQuiz(otherLessonId);

    expect(getQuizInLesson(quiz.id, lessonId)).toBeUndefined();
  });

  it("returns nothing for a quiz id that does not exist", () => {
    addQuiz(lessonId);

    expect(getQuizInLesson(9999, lessonId)).toBeUndefined();
  });
});
