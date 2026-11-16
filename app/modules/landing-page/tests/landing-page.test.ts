import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { CourseStatus, UserRole } from "~/db/schema";
import { markdown } from "~/lib/text";
import { createLandingPage } from "../index.server";

let db: TestDb;
let categoryId: number;

beforeEach(() => {
  db = createTestDb();
  categoryId = db
    .insert(schema.categories)
    .values({ name: "Programming", slug: "programming" })
    .returning()
    .get().id;
});

// ─── Fixtures ───
// No module owns writing courses, modules or lessons yet, so rows go in
// directly. Kept in one place so a schema change touches only this block.

let counter = 0;

function addInstructor(name: string) {
  counter += 1;
  return db
    .insert(schema.users)
    .values({
      name,
      email: `instructor-${counter}@example.com`,
      role: UserRole.Instructor,
    })
    .returning()
    .get();
}

function addCourse(
  instructorId: number,
  title: string,
  options: { status?: CourseStatus; createdAt?: string; lessons?: number } = {}
) {
  counter += 1;
  const course = db
    .insert(schema.courses)
    .values({
      title,
      slug: `course-${counter}`,
      description: `About ${title}`,
      salesCopy: markdown(`## ${title}`),
      instructorId,
      categoryId,
      status: options.status ?? CourseStatus.Published,
      coverImageUrl: `/covers/${counter}.png`,
      createdAt: options.createdAt ?? "2026-01-01T00:00:00.000Z",
    })
    .returning()
    .get();
  addLessons(course.id, options.lessons ?? 0);
  return course;
}

function addLessons(courseId: number, count: number) {
  if (count === 0) return;
  const module = db
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();
  for (let position = 1; position <= count; position++) {
    db.insert(schema.lessons)
      .values({ moduleId: module.id, title: `Lesson ${position}`, position })
      .run();
  }
}

function landing() {
  return createLandingPage(db).get();
}

describe("landing page: newest courses", () => {
  it("lists the three newest published courses, newest first", () => {
    const instructor = addInstructor("Ada");
    addCourse(instructor.id, "Oldest", { createdAt: "2026-01-01T00:00:00Z" });
    addCourse(instructor.id, "Newest", { createdAt: "2026-04-01T00:00:00Z" });
    addCourse(instructor.id, "Second", { createdAt: "2026-03-01T00:00:00Z" });
    addCourse(instructor.id, "Third", { createdAt: "2026-02-01T00:00:00Z" });

    expect(landing().newestCourses.map((c) => c.title)).toEqual([
      "Newest",
      "Second",
      "Third",
    ]);
  });

  it("leaves out drafts and archived courses", () => {
    const instructor = addInstructor("Ada");
    addCourse(instructor.id, "Live");
    addCourse(instructor.id, "Draft", {
      status: CourseStatus.Draft,
      createdAt: "2026-05-01T00:00:00Z",
    });
    addCourse(instructor.id, "Archived", {
      status: CourseStatus.Archived,
      createdAt: "2026-05-01T00:00:00Z",
    });

    expect(landing().newestCourses.map((c) => c.title)).toEqual(["Live"]);
  });

  it("gives each course its instructor, cover and lesson count", () => {
    const instructor = addInstructor("Ada Lovelace");
    const course = addCourse(instructor.id, "Engines", { lessons: 4 });

    expect(landing().newestCourses).toEqual([
      {
        id: course.id,
        title: "Engines",
        slug: course.slug,
        description: "About Engines",
        coverImageUrl: course.coverImageUrl,
        instructorName: "Ada Lovelace",
        lessonCount: 4,
      },
    ]);
  });

  it("counts a course with no lessons as zero lessons", () => {
    addCourse(addInstructor("Ada").id, "Empty");

    expect(landing().newestCourses[0].lessonCount).toBe(0);
  });

  it("counts lessons across every module of a course", () => {
    const course = addCourse(addInstructor("Ada").id, "Two modules", {
      lessons: 2,
    });
    addLessons(course.id, 3);

    expect(landing().newestCourses[0].lessonCount).toBe(5);
  });

  it("is empty when nothing is published", () => {
    addCourse(addInstructor("Ada").id, "Draft", {
      status: CourseStatus.Draft,
    });

    expect(landing().newestCourses).toEqual([]);
  });
});

describe("landing page: catalogue stats", () => {
  it("totals published courses, their lessons and their instructors", () => {
    const ada = addInstructor("Ada");
    const grace = addInstructor("Grace");
    addCourse(ada.id, "One", { lessons: 2 });
    addCourse(ada.id, "Two", { lessons: 3 });
    addCourse(grace.id, "Three", { lessons: 1 });
    addCourse(grace.id, "Four", { lessons: 1 });
    addCourse(grace.id, "Five");

    expect(landing().stats).toEqual({
      courses: 5,
      lessons: 7,
      instructors: 2,
    });
  });

  it("counts nothing from drafts, archived courses or their instructors", () => {
    addCourse(addInstructor("Ada").id, "Live", { lessons: 2 });
    addCourse(addInstructor("Draft author").id, "Draft", {
      status: CourseStatus.Draft,
      lessons: 5,
    });
    addCourse(addInstructor("Archivist").id, "Archived", {
      status: CourseStatus.Archived,
      lessons: 5,
    });

    expect(landing().stats).toEqual({ courses: 1, lessons: 2, instructors: 1 });
  });

  it("is all zeros for an empty catalogue", () => {
    expect(landing().stats).toEqual({ courses: 0, lessons: 0, instructors: 0 });
  });
});
