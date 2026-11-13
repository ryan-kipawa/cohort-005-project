import { eq } from "drizzle-orm";
import { courses, CourseStatus, users } from "~/db/schema";
import { notify, type Db } from "~/lib/notifications.server";

// ─── Courses ───
// Course changes that raise Notifications. Every function takes the database
// first and `now` last, so tests can hand in an in-memory one.

/**
 * A Platform Admin or the course's Instructor changes a course's status. The
 * Instructor who owns the course gets a course_status_changed Notification,
 * unless they changed it themselves. Returns the updated course, or null when
 * there is no such course.
 *
 * Archiving a course also gives every Student enrolled on it a course_archived
 * Notification, whoever archived it.
 */
export function changeCourseStatus(
  db: Db,
  actorId: number,
  courseId: number,
  status: CourseStatus,
  now: Date
) {
  return db.transaction((tx) => {
    const course = tx.select().from(courses).where(eq(courses.id, courseId)).get();
    if (!course) return null;

    const updated = tx
      .update(courses)
      .set({ status, updatedAt: now.toISOString() })
      .where(eq(courses.id, courseId))
      .returning()
      .get();

    if (course.status === status) return updated;

    const actor = tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, actorId))
      .get();

    const actorRef = {
      type: "user" as const,
      id: actorId,
      label: actor?.name ?? "Someone",
    };
    const courseRef = { type: "course" as const, id: course.id, label: course.title };

    notify(
      tx,
      actorId,
      "course_status_changed",
      {
        actor: actorRef,
        object: courseRef,
        change: { from: course.status, to: status },
      },
      `/instructor/${course.id}`,
      { user: course.instructorId },
      now
    );

    if (status === CourseStatus.Archived) {
      notify(
        tx,
        actorId,
        "course_archived",
        { actor: actorRef, object: courseRef },
        `/courses/${course.slug}`,
        { courseStudents: course.id },
        now
      );
    }

    return updated;
  });
}
