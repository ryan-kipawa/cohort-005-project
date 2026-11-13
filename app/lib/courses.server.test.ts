import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { CourseStatus, UserRole } from "~/db/schema";
import { eq } from "drizzle-orm";
import { getNotificationInbox } from "./notifications.server";
import { changeCourseStatus } from "./courses.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let platformAdmin: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  platformAdmin = db
    .insert(schema.users)
    .values({ name: "Pat Admin", email: "pat@example.com", role: UserRole.Admin })
    .returning()
    .get();
});

function inboxRows(userId: number) {
  const inbox = getNotificationInbox(db, userId, NOW);
  return [...inbox.today, ...inbox.earlier];
}

describe("course_status_changed", () => {
  it("tells the owning Instructor when a Platform Admin changes their course's status, from what to what", () => {
    changeCourseStatus(db, platformAdmin.id, base.course.id, CourseStatus.Draft, NOW);

    expect(inboxRows(base.instructor.id)).toEqual([
      expect.objectContaining({
        kind: "course_status_changed",
        category: "Courses",
        title: "Test Course was moved from Published to Draft",
        url: `/instructor/${base.course.id}`,
        read: false,
      }),
    ]);
  });

  it("is not raised when the Instructor changes their own course's status", () => {
    changeCourseStatus(db, base.instructor.id, base.course.id, CourseStatus.Draft, NOW);

    expect(inboxRows(base.instructor.id)).toEqual([]);
  });
});

function enrol(name: string, email: string) {
  const student = db
    .insert(schema.users)
    .values({ name, email, role: UserRole.Student })
    .returning()
    .get();
  db.insert(schema.enrollments)
    .values({ userId: student.id, courseId: base.course.id })
    .run();
  return student;
}

describe("course_archived", () => {
  it("tells every enrolled Student when a Platform Admin archives the course", () => {
    const ada = enrol("Ada", "ada@example.com");
    const ben = enrol("Ben", "ben@example.com");

    changeCourseStatus(db, platformAdmin.id, base.course.id, CourseStatus.Archived, NOW);

    for (const student of [ada, ben]) {
      expect(inboxRows(student.id)).toEqual([
        expect.objectContaining({
          kind: "course_archived",
          category: "Courses",
          title: "Test Course was archived",
          url: "/courses/test-course",
          read: false,
        }),
      ]);
    }
    expect(inboxRows(base.user.id)).toEqual([]);
    expect(inboxRows(platformAdmin.id)).toEqual([]);
  });

  it("tells every enrolled Student when the Instructor archives the course, but not the Instructor", () => {
    const ada = enrol("Ada", "ada@example.com");

    changeCourseStatus(db, base.instructor.id, base.course.id, CourseStatus.Archived, NOW);

    expect(inboxRows(ada.id).map((row) => row.title)).toEqual([
      "Test Course was archived",
    ]);
    expect(inboxRows(base.instructor.id)).toEqual([]);
  });

  it("still shows the course's title from when it was archived after the course is renamed", () => {
    const ada = enrol("Ada", "ada@example.com");

    changeCourseStatus(db, platformAdmin.id, base.course.id, CourseStatus.Archived, NOW);
    db.update(schema.courses)
      .set({ title: "Renamed Course" })
      .where(eq(schema.courses.id, base.course.id))
      .run();

    expect(inboxRows(ada.id).map((row) => row.title)).toEqual([
      "Test Course was archived",
    ]);
  });

  it("is not raised for a status change that doesn't archive the course", () => {
    const ada = enrol("Ada", "ada@example.com");

    changeCourseStatus(db, platformAdmin.id, base.course.id, CourseStatus.Draft, NOW);

    expect(inboxRows(ada.id)).toEqual([]);
  });
});
