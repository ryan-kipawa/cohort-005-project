import { eq } from "drizzle-orm";
import { comments, courses, lessons, modules, users, UserRole } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import { excerpt, ref, userRef } from "~/lib/notification-refs.server";
import { notify, type Db, type Tx } from "~/lib/notifications.server";

// ─── Lesson Threads ───
// Starting a Lesson Thread, replying in one, and editing or deleting a post,
// each with the Notifications it raises in the same transaction. Every
// function takes the database first and `now` last, so tests can hand in an
// in-memory one. Routes keep authorization (who may edit or delete a post)
// and form parsing.

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

function lessonRef(lesson: LessonContext) {
  return ref("lesson", lesson.lessonId, lesson.lessonTitle);
}

/**
 * Someone starts a Lesson Thread under a lesson. When a Student started it,
 * the course's Instructor gets a lesson_thread_started Notification. A thread
 * started by the Instructor or a Platform Admin raises nothing.
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

    if (speaksForCourse(tx, userId, lesson)) return openingPost;

    notify(
      tx,
      {
        kind: "lesson_thread_started",
        data: {
          actor: userRef(tx, userId),
          object: ref("lesson_thread", openingPost.id, lesson.lessonTitle),
          target: lessonRef(lesson),
          excerpt: excerpt(trimmed),
        },
        url: lessonUrl(lesson),
        recipients: { user: lesson.instructorId },
      },
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
      {
        kind: speaksForCourse(tx, userId, lesson)
          ? "lesson_thread_answer"
          : "lesson_thread_reply",
        data: {
          actor: userRef(tx, userId),
          object: ref("reply", reply.id, lesson.lessonTitle),
          target: ref("lesson_thread", openingPost.id, lesson.lessonTitle),
          excerpt: excerpt(trimmed),
        },
        url: lessonUrl(lesson),
        recipients: { user: openingPost.userId },
      },
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

/**
 * The author edits their opening post or reply. Raises nothing. The route
 * checks that `userId` is the author.
 */
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
 * Notification quoting what they wrote, captured before the deletion. The
 * route checks that `userId` may delete it.
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

    if (post.deletedAt !== null) return post;

    const deleted = tx
      .update(comments)
      .set({ deletedAt: now.toISOString() })
      .where(eq(comments.id, postId))
      .returning()
      .get();

    notify(
      tx,
      {
        kind: "post_deleted",
        data: {
          actor: userRef(tx, userId),
          object: ref(
            post.parentId === null ? "lesson_thread" : "reply",
            post.id,
            lesson.lessonTitle
          ),
          target: lessonRef(lesson),
          excerpt: excerpt(post.body),
        },
        url: lessonUrl(lesson),
        recipients: { user: post.userId },
      },
      now
    );

    return deleted;
  });
}
