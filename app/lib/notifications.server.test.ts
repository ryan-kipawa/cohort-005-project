import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { eq } from "drizzle-orm";
import {
  getNotificationInbox,
  getNotificationInboxPage,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationsRead,
  notify,
  openNotification,
} from "./notifications.server";
import { changeUserRole } from "./users.server";

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

describe("role_changed", () => {
  it("tells the user their role changed, from what to what", () => {
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Instructor, NOW);

    const inbox = getNotificationInbox(db, base.user.id, NOW);

    expect(inbox.today).toEqual([
      expect.objectContaining({
        title: "Your role was changed from Student to Instructor",
        category: "Account",
        url: "/dashboard",
        read: false,
      }),
    ]);
    expect(inbox.earlier).toEqual([]);
    expect(getUnreadNotificationCount(db, base.user.id, NOW)).toBe(1);
  });

  it("is not raised when a Platform Admin changes their own role", () => {
    changeUserRole(db, platformAdmin.id, platformAdmin.id, UserRole.Instructor, NOW);

    expect(getNotificationInbox(db, platformAdmin.id, NOW)).toEqual({
      today: [],
      earlier: [],
    });
    expect(getUnreadNotificationCount(db, platformAdmin.id, NOW)).toBe(0);
  });
});

function hoursBefore(when: Date, hours: number) {
  return new Date(when.getTime() - hours * 60 * 60 * 1000);
}

function daysBefore(when: Date, days: number) {
  const earlier = new Date(when);
  earlier.setDate(earlier.getDate() - days);
  return earlier;
}

function titles(inbox: ReturnType<typeof getNotificationInbox>) {
  return [...inbox.today, ...inbox.earlier].map((row) => row.title);
}

describe("the wording", () => {
  it("is rendered from the facts captured when it was raised, so a later rename doesn't change it", () => {
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Instructor, NOW);

    db.update(schema.users)
      .set({ name: "Patricia Admin" })
      .where(eq(schema.users.id, platformAdmin.id))
      .run();

    const [row] = getNotificationInbox(db, base.user.id, NOW).today;
    expect(row.body).toBe(
      "Pat Admin changed your role. What you can do on Cadence has changed with it."
    );
  });
});

describe("Today and Earlier", () => {
  it("puts Notifications raised on today's date under Today and older ones under Earlier", () => {
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Instructor, daysBefore(NOW, 2));
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Admin, hoursBefore(NOW, 3));

    const inbox = getNotificationInbox(db, base.user.id, NOW);

    expect(inbox.today.map((row) => row.title)).toEqual([
      "Your role was changed from Instructor to Admin",
    ]);
    expect(inbox.earlier.map((row) => row.title)).toEqual([
      "Your role was changed from Student to Instructor",
    ]);
  });
});

describe("marking read", () => {
  it("opening the inbox marks nothing read", () => {
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Instructor, NOW);

    getNotificationInbox(db, base.user.id, NOW);

    expect(getNotificationInbox(db, base.user.id, NOW).today[0].read).toBe(false);
    expect(getUnreadNotificationCount(db, base.user.id, NOW)).toBe(1);
  });

  it("Mark read marks the row read and takes it off the unread count", () => {
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Instructor, NOW);
    const [row] = getNotificationInbox(db, base.user.id, NOW).today;

    markNotificationsRead(db, base.user.id, row.ids, NOW);

    expect(getNotificationInbox(db, base.user.id, NOW).today).toEqual([
      expect.objectContaining({ title: row.title, read: true }),
    ]);
    expect(getUnreadNotificationCount(db, base.user.id, NOW)).toBe(0);
  });

  it("opening a row marks it read and gives its link", () => {
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Instructor, NOW);
    const [row] = getNotificationInbox(db, base.user.id, NOW).today;

    expect(openNotification(db, base.user.id, row.ids, NOW)).toBe("/dashboard");
    expect(getUnreadNotificationCount(db, base.user.id, NOW)).toBe(0);
  });

  it("nobody can mark or open someone else's Notifications", () => {
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Instructor, NOW);
    const [row] = getNotificationInbox(db, base.user.id, NOW).today;

    markNotificationsRead(db, base.instructor.id, row.ids, NOW);
    expect(openNotification(db, base.instructor.id, row.ids, NOW)).toBeNull();

    expect(getNotificationInbox(db, base.user.id, NOW).today[0].read).toBe(false);
    expect(getUnreadNotificationCount(db, base.user.id, NOW)).toBe(1);
  });
});

describe("retention", () => {
  it("never shows a Notification older than 90 days", () => {
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Instructor, daysBefore(NOW, 91));

    expect(titles(getNotificationInbox(db, base.user.id, NOW))).toEqual([]);
    expect(getUnreadNotificationCount(db, base.user.id, NOW)).toBe(0);
  });

  it("raising a Notification deletes that Notification Recipient's ones older than 90 days", () => {
    const longAgo = daysBefore(NOW, 91);
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Instructor, longAgo);
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Admin, NOW);

    // Seen from the day the first one was raised it is well within 90 days,
    // so it can only be missing because it was deleted.
    expect(titles(getNotificationInbox(db, base.user.id, longAgo))).toEqual([
      "Your role was changed from Instructor to Admin",
    ]);
  });

  it("keeps Notifications younger than 90 days when a new one is raised", () => {
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Instructor, daysBefore(NOW, 89));
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Admin, NOW);

    expect(titles(getNotificationInbox(db, base.user.id, NOW))).toEqual([
      "Your role was changed from Instructor to Admin",
      "Your role was changed from Student to Instructor",
    ]);
  });
});

// ─── Filters, Mark all as read and paging ───
// These raise real kinds directly: refund_request_declined (Money),
// lesson_thread_reply (Discussion) and new_student (Courses, grouped by
// course).

function raiseMoney(recipientId: number, label: string, when = NOW) {
  notify(
    db,
    {
      kind: "refund_request_declined",
      data: {
        actor: { type: "user", id: platformAdmin.id, label: "Pat Admin" },
        object: { type: "refund_request", id: 1, label },
        target: { type: "individual_purchase", id: 1, label },
      },
      url: "/settings",
      recipients: { user: recipientId },
    },
    when
  );
}

function raiseReply(recipientId: number, lessonTitle: string, when = NOW) {
  notify(
    db,
    {
      kind: "lesson_thread_reply",
      data: {
        actor: { type: "user", id: platformAdmin.id, label: "Pat Admin" },
        object: { type: "reply", id: 1, label: lessonTitle },
        target: { type: "lesson_thread", id: 1, label: lessonTitle },
      },
      url: "/thread",
      recipients: { user: recipientId },
    },
    when
  );
}

function raiseNewStudent(recipientId: number, studentName: string, when = NOW) {
  notify(
    db,
    {
      kind: "new_student",
      data: {
        actor: { type: "user", id: platformAdmin.id, label: studentName },
        object: { type: "user", id: platformAdmin.id, label: studentName },
        target: { type: "course", id: base.course.id, label: "Test Course" },
      },
      url: "/students",
      recipients: { user: recipientId },
    },
    when
  );
}

function allTitles(page: ReturnType<typeof getNotificationInboxPage>) {
  return [...page.today, ...page.earlier].map((row) => row.title);
}

describe("filtering by Notification Category", () => {
  it("offers only the categories the Notification Recipient has Notifications in", () => {
    raiseMoney(base.user.id, "Refund 1");
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Instructor, NOW);
    raiseReply(base.instructor.id, "Closures");

    expect(getNotificationInboxPage(db, base.user.id, NOW).categories).toEqual([
      "Money",
      "Account",
    ]);
  });

  it("offers no categories when there are no Notifications", () => {
    expect(getNotificationInboxPage(db, base.user.id, NOW).categories).toEqual([]);
  });

  it("shows only the chosen category's rows, while still offering every category", () => {
    raiseMoney(base.user.id, "Refund 1");
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Instructor, NOW);

    const page = getNotificationInboxPage(db, base.user.id, NOW, {
      category: "Money",
    });

    expect(allTitles(page)).toEqual(["Your refund for Refund 1 was declined"]);
    expect(page.categories).toEqual(["Money", "Account"]);
  });
});

describe("Unread only", () => {
  it("hides read rows", () => {
    raiseMoney(base.user.id, "Refund 1", hoursBefore(NOW, 2));
    raiseMoney(base.user.id, "Refund 2", hoursBefore(NOW, 1));
    const [newest] = getNotificationInboxPage(db, base.user.id, NOW).today;
    markNotificationsRead(db, base.user.id, newest.ids, NOW);

    const page = getNotificationInboxPage(db, base.user.id, NOW, { unreadOnly: true });

    expect(allTitles(page)).toEqual(["Your refund for Refund 1 was declined"]);
  });

  it("combines with a category", () => {
    raiseMoney(base.user.id, "Refund 1", hoursBefore(NOW, 3));
    raiseMoney(base.user.id, "Refund 2", hoursBefore(NOW, 2));
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Instructor, hoursBefore(NOW, 1));
    const [, refund2] = getNotificationInboxPage(db, base.user.id, NOW).today;
    markNotificationsRead(db, base.user.id, refund2.ids, NOW);

    const page = getNotificationInboxPage(db, base.user.id, NOW, {
      category: "Money",
      unreadOnly: true,
    });

    expect(allTitles(page)).toEqual(["Your refund for Refund 1 was declined"]);
  });
});

describe("Mark all as read", () => {
  it("with a category chosen, marks only that category's Notifications read", () => {
    raiseMoney(base.user.id, "Refund 1");
    raiseReply(base.user.id, "Closures");
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Instructor, NOW);

    markAllNotificationsRead(db, base.user.id, "Money", NOW);

    const unread = getNotificationInboxPage(db, base.user.id, NOW, { unreadOnly: true });
    expect(allTitles(unread)).toEqual([
      "Your role was changed from Student to Instructor",
      "Pat Admin replied to your Lesson Thread on Closures",
    ]);
  });

  it("with All chosen, marks everything read", () => {
    raiseMoney(base.user.id, "Refund 1");
    raiseReply(base.user.id, "Closures");
    raiseReply(base.user.id, "Closures");
    changeUserRole(db, platformAdmin.id, base.user.id, UserRole.Instructor, NOW);

    markAllNotificationsRead(db, base.user.id, undefined, NOW);

    expect(getUnreadNotificationCount(db, base.user.id, NOW)).toBe(0);
  });

  it("never marks another Notification Recipient's Notifications read", () => {
    raiseMoney(base.user.id, "Refund 1");
    raiseMoney(base.instructor.id, "Refund 2");

    markAllNotificationsRead(db, base.instructor.id, undefined, NOW);
    markAllNotificationsRead(db, base.instructor.id, "Money", NOW);

    expect(getUnreadNotificationCount(db, base.user.id, NOW)).toBe(1);
    expect(getUnreadNotificationCount(db, base.instructor.id, NOW)).toBe(0);
  });
});

describe("paging", () => {
  it("shows 50 rows, a grouped row counting once, and Load more shows the next 50", () => {
    // 3 new Students on one course make one row, the newest.
    for (const name of ["Ann", "Bob", "Cal"]) raiseNewStudent(base.user.id, name, NOW);
    for (let i = 1; i <= 60; i++) {
      raiseMoney(base.user.id, `Refund ${i}`, hoursBefore(NOW, i));
    }

    const first = getNotificationInboxPage(db, base.user.id, NOW);
    expect(allTitles(first)).toHaveLength(50);
    expect(allTitles(first)[0]).toBe("Cal and 2 others joined Test Course");
    expect(allTitles(first)[49]).toBe("Your refund for Refund 49 was declined");
    expect(first.hasMore).toBe(true);

    const more = getNotificationInboxPage(db, base.user.id, NOW, { limit: 100 });
    expect(allTitles(more)).toHaveLength(61);
    expect(allTitles(more)[60]).toBe("Your refund for Refund 60 was declined");
    expect(more.hasMore).toBe(false);
  });
});
