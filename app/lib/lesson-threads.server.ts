import { eq } from "drizzle-orm";
import { comments, courses, lessons, modules, users, UserRole } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import { notify, type Db, type Tx } from "~/lib/notifications.server";

// ─── Lesson Threads ───
// Starting a Lesson Thread, replying in one, and editing or deleting a post,
// each with the Notifications it raises in the same transaction. Every
// function takes the database first and `now` last, so tests can hand in an
// in-memory one. Routes keep authorization and form parsing.

/** How much of a post a Notification quotes. */
const EXCERPT_LENGTH = 140;

function excerpt(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_LENGTH
    ? flat
    : `${flat.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`;
}

function assertValidBody(body: string) {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(`Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`);
  }
  return trimmed;
}

function getLessonContext(tx: Tx, lessonId: number) {
  return tx
    .select({
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

type LessonContext = NonNullable<ReturnType<typeof getLessonContext>>;

function lessonUrl(lesson: LessonContext) {
  return `/courses/${lesson.courseSlug}/lessons/${lesson.lessonId}`;
}

function getUser(tx: Tx, userId: number) {
  return tx.select().from(users).where(eq(users.id, userId)).get();
}

function userRef(tx: Tx, userId: number) {
  return { type: "user" as const, id: userId, label: getUser(tx, userId)?.name ?? "Someone" };
}

function lessonRef(lesson: LessonContext) {
  return { type: "lesson" as const, id: lesson.lessonId, label: lesson.lessonTitle };
}

/**
 * Someone starts a Lesson Thread under a lesson. The course's Instructor gets
 * a lesson_thread_started Notification, unless they started it.
 */
export function startLessonThread(
  db: Db,
  userId: number,
  lessonId: number,
  body: string,
  now: Date
) {
  const trimmed = assertValidBody(body);

  return db.transaction((tx) => {
    const lesson = getLessonContext(tx, lessonId);
    if (!lesson) throw new Error("Lesson not found");

    const openingPost = tx
      .insert(comments)
      .values({ userId, lessonId, parentId: null, body: trimmed, createdAt: now.toISOString() })
      .returning()
      .get();

    notify(
      tx,
      userId,
      "lesson_thread_started",
      {
        actor: userRef(tx, userId),
        object: { type: "lesson_thread", id: openingPost.id, label: lesson.lessonTitle },
        target: lessonRef(lesson),
        excerpt: excerpt(trimmed),
      },
      lessonUrl(lesson),
      { user: lesson.instructorId },
      now
    );

    return openingPost;
  });
}

/**
 * Someone replies in a Lesson Thread. Whoever started it gets a
 * lesson_thread_reply Notification, or a lesson_thread_answer one when the
 * reply is by the course's Instructor or a Platform Admin. Nobody else who
 * replied is told, and replying in your own Lesson Thread raises nothing.
 */
export function replyToLessonThread(
  db: Db,
  userId: number,
  lessonId: number,
  openingPostId: number,
  body: string,
  now: Date
) {
  const trimmed = assertValidBody(body);

  return db.transaction((tx) => {
    const lesson = getLessonContext(tx, lessonId);
    if (!lesson) throw new Error("Lesson not found");

    const openingPost = tx
      .select()
      .from(comments)
      .where(eq(comments.id, openingPostId))
      .get();
    if (!openingPost) throw new Error("Parent comment not found");
    if (openingPost.lessonId !== lessonId) {
      throw new Error("Parent comment belongs to a different lesson");
    }
    if (openingPost.parentId !== null) {
      throw new Error("Replies can only be one level deep");
    }

    const reply = tx
      .insert(comments)
      .values({
        userId,
        lessonId,
        parentId: openingPost.id,
        body: trimmed,
        createdAt: now.toISOString(),
      })
      .returning()
      .get();

    notify(
      tx,
      userId,
      speaksForCourse(tx, userId, lesson) ? "lesson_thread_answer" : "lesson_thread_reply",
      {
        actor: userRef(tx, userId),
        object: { type: "reply", id: reply.id, label: lesson.lessonTitle },
        target: { type: "lesson_thread", id: openingPost.id, label: lesson.lessonTitle },
        excerpt: excerpt(trimmed),
      },
      lessonUrl(lesson),
      { user: openingPost.userId },
      now
    );

    return reply;
  });
}

/** The course's Instructor or a Platform Admin. */
function speaksForCourse(tx: Tx, userId: number, lesson: LessonContext) {
  return lesson.instructorId === userId || getUser(tx, userId)?.role === UserRole.Admin;
}

function getPost(tx: Tx, postId: number) {
  return tx.select().from(comments).where(eq(comments.id, postId)).get();
}

/** The author edits their opening post or reply. Raises nothing. */
export function editLessonThreadPost(
  db: Db,
  userId: number,
  postId: number,
  body: string,
  now: Date
) {
  const trimmed = assertValidBody(body);

  return db.transaction((tx) => {
    const post = getPost(tx, postId);
    if (!post) throw new Error("Comment not found");
    if (post.deletedAt !== null) throw new Error("Comment has been deleted");
    if (post.userId !== userId) {
      throw new Error("You can only edit your own comments");
    }

    return tx
      .update(comments)
      .set({ body: trimmed, editedAt: now.toISOString() })
      .where(eq(comments.id, postId))
      .returning()
      .get();
  });
}

/**
 * The author, the course's Instructor or a Platform Admin deletes an opening
 * post or reply. When it wasn't the author, the author gets a post_deleted
 * Notification quoting what they wrote, captured before the deletion.
 */
export function deleteLessonThreadPost(
  db: Db,
  userId: number,
  postId: number,
  now: Date
) {
  return db.transaction((tx) => {
    const post = getPost(tx, postId);
    if (!post) throw new Error("Comment not found");

    const lesson = getLessonContext(tx, post.lessonId);
    if (!lesson) throw new Error("Lesson not found");

    if (post.userId !== userId && !speaksForCourse(tx, userId, lesson)) {
      throw new Error("You can only delete your own comments");
    }
    if (post.deletedAt !== null) return post;

    const deleted = tx
      .update(comments)
      .set({ deletedAt: now.toISOString() })
      .where(eq(comments.id, postId))
      .returning()
      .get();

    notify(
      tx,
      userId,
      "post_deleted",
      {
        actor: userRef(tx, userId),
        object: {
          type: post.parentId === null ? "lesson_thread" : "reply",
          id: post.id,
          label: lesson.lessonTitle,
        },
        target: lessonRef(lesson),
        excerpt: excerpt(post.body),
      },
      lessonUrl(lesson),
      { user: post.userId },
      now
    );

    return deleted;
  });
}
