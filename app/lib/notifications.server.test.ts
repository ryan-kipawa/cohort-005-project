import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { eq } from "drizzle-orm";
import {
  getNotificationInbox,
  getUnreadNotificationCount,
  markNotificationsRead,
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
