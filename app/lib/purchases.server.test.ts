import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  getNotificationInbox,
  getUnreadNotificationCount,
  markNotificationsRead,
} from "./notifications.server";
import { claimSeat, makeIndividualPurchase } from "./purchases.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase().replace(/ /g, ".")}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

function rows(userId: number, now = NOW) {
  const inbox = getNotificationInbox(db, userId, now);
  return [...inbox.today, ...inbox.earlier];
}

/** A Team Licence `teamAdminId` bought for the base course, with `seats` Seats. */
function buyTeamLicence(teamAdminId: number, seats: number) {
  const purchase = db
    .insert(schema.purchases)
    .values({ userId: teamAdminId, courseId: base.course.id, amountPaid: 4900 * seats, country: "NL" })
    .returning()
    .get();
  const team = db.insert(schema.teams).values({}).returning().get();
  db.insert(schema.teamMembers)
    .values({ teamId: team.id, userId: teamAdminId, role: schema.TeamMemberRole.Admin })
    .run();
  return Array.from({ length: seats }, (_, i) =>
    db
      .insert(schema.coupons)
      .values({ teamId: team.id, courseId: base.course.id, code: `seat-${purchase.id}-${i}`, purchaseId: purchase.id })
      .returning()
      .get()
  );
}

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

describe("new_student", () => {
  it("an Individual Purchase tells the course's Instructor a Student joined", () => {
    makeIndividualPurchase(db, base.user.id, base.course.id, 4900, "NL", NOW);

    expect(rows(base.instructor.id)).toEqual([
      expect.objectContaining({
        title: "Test User joined Test Course",
        category: "Courses",
        url: `/instructor/${base.course.id}/students`,
        read: false,
      }),
    ]);
  });
});

describe("claiming a Seat", () => {
  it("tells the Team Admin their Team Licence can no longer be refunded", () => {
    const teamAdmin = addStudent("Bossy McBossface");
    const [seat] = buyTeamLicence(teamAdmin.id, 3);

    expect(claimSeat(db, seat.code, base.user.id, "NL", NOW)).toMatchObject({ ok: true });

    expect(rows(teamAdmin.id)).toEqual([
      expect.objectContaining({
        title: "Test User claimed a Seat on your Team Licence for Test Course",
        body: "Your Team Licence can no longer be refunded.",
        category: "Money",
        url: "/team",
        read: false,
      }),
    ]);
  });

  it("tells the course's Instructor a Student joined", () => {
    const teamAdmin = addStudent("Bossy McBossface");
    const [seat] = buyTeamLicence(teamAdmin.id, 3);

    claimSeat(db, seat.code, base.user.id, "NL", NOW);

    expect(rows(base.instructor.id)).toEqual([
      expect.objectContaining({
        title: "Test User joined Test Course",
        url: `/instructor/${base.course.id}/students`,
      }),
    ]);
  });

  it("gives a Team Admin who claims a Seat on their own Team Licence no seat_claimed Notification", () => {
    const teamAdmin = addStudent("Bossy McBossface");
    const [seat] = buyTeamLicence(teamAdmin.id, 3);

    expect(claimSeat(db, seat.code, teamAdmin.id, "NL", NOW)).toMatchObject({ ok: true });

    expect(rows(teamAdmin.id)).toEqual([]);
    expect(rows(base.instructor.id)).toEqual([
      expect.objectContaining({ title: "Bossy McBossface joined Test Course" }),
    ]);
  });

  it("raises nothing when the Seat can't be claimed", () => {
    const teamAdmin = addStudent("Bossy McBossface");
    const [seat] = buyTeamLicence(teamAdmin.id, 3);

    expect(claimSeat(db, seat.code, base.user.id, "DE", NOW)).toMatchObject({ ok: false });

    expect(rows(teamAdmin.id)).toEqual([]);
    expect(rows(base.instructor.id)).toEqual([]);
  });
});

function minutesAfter(when: Date, minutes: number) {
  return new Date(when.getTime() + minutes * 60 * 1000);
}

describe("grouping new_student by course", () => {
  function addCourse(title: string) {
    return db
      .insert(schema.courses)
      .values({
        title,
        slug: title.toLowerCase().replace(/ /g, "-"),
        description: title,
        salesCopy: title,
        instructorId: base.instructor.id,
        categoryId: base.category.id,
        status: schema.CourseStatus.Published,
      })
      .returning()
      .get();
  }

  function threeStudentsJoin(courseId: number) {
    const names = ["Liam Chen", "Olivia Park", "Emma Wilson"];
    names.forEach((name, i) =>
      makeIndividualPurchase(db, addStudent(name).id, courseId, 4900, "NL", minutesAfter(NOW, i))
    );
  }

  const LATER = minutesAfter(NOW, 60);

  it("shows three unread new Students on one course as one row, counted once", () => {
    threeStudentsJoin(base.course.id);

    expect(rows(base.instructor.id, LATER)).toEqual([
      expect.objectContaining({
        title: "Emma Wilson and 2 others joined Test Course",
        read: false,
      }),
    ]);
    expect(getUnreadNotificationCount(db, base.instructor.id, LATER)).toBe(1);
  });

  it("doesn't group new Students on different courses together", () => {
    const other = addCourse("Other Course");
    makeIndividualPurchase(db, addStudent("Liam Chen").id, base.course.id, 4900, "NL", NOW);
    makeIndividualPurchase(db, addStudent("Olivia Park").id, other.id, 4900, "NL", minutesAfter(NOW, 1));

    expect(rows(base.instructor.id, LATER).map((row) => row.title)).toEqual([
      "Olivia Park joined Other Course",
      "Liam Chen joined Test Course",
    ]);
    expect(getUnreadNotificationCount(db, base.instructor.id, LATER)).toBe(2);
  });

  it("marking a grouped row read marks every Notification in it read", () => {
    threeStudentsJoin(base.course.id);
    const [row] = rows(base.instructor.id, LATER);

    markNotificationsRead(db, base.instructor.id, row.ids, LATER);

    expect(rows(base.instructor.id, LATER)).toEqual([
      expect.objectContaining({
        title: "Emma Wilson and 2 others joined Test Course",
        read: true,
      }),
    ]);
    expect(getUnreadNotificationCount(db, base.instructor.id, LATER)).toBe(0);
  });

  it("after a group is read, a new Student shows as a separate unread row and the old group stays read", () => {
    threeStudentsJoin(base.course.id);
    const [row] = rows(base.instructor.id, LATER);
    markNotificationsRead(db, base.instructor.id, row.ids, LATER);

    makeIndividualPurchase(db, addStudent("Noah Diaz").id, base.course.id, 4900, "NL", LATER);

    expect(rows(base.instructor.id, LATER)).toEqual([
      expect.objectContaining({ title: "Noah Diaz joined Test Course", read: false }),
      expect.objectContaining({
        title: "Emma Wilson and 2 others joined Test Course",
        read: true,
      }),
    ]);
    expect(getUnreadNotificationCount(db, base.instructor.id, LATER)).toBe(1);
  });

  it("groups a Seat claim with Individual Purchases on the same course", () => {
    const teamAdmin = addStudent("Bossy McBossface");
    const [seat] = buyTeamLicence(teamAdmin.id, 1);
    makeIndividualPurchase(db, addStudent("Liam Chen").id, base.course.id, 4900, "NL", NOW);
    claimSeat(db, seat.code, base.user.id, "NL", minutesAfter(NOW, 1));

    expect(rows(base.instructor.id, LATER).map((row) => row.title)).toEqual([
      "Test User and 1 other joined Test Course",
    ]);
  });
});
