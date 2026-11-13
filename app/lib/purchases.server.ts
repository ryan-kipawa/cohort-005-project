import { and, eq } from "drizzle-orm";
import { coupons, enrollments, purchases } from "~/db/schema";
import { courseLabel, ref, userRef } from "~/lib/notification-refs.server";
import { notify, type Db, type Tx } from "~/lib/notifications.server";
import { getSeatAvailability } from "~/lib/refunds.server";

// ─── Purchases and Seats ───
// A Student buying a course for themselves, or claiming a Seat on a Team
// Licence. Each wraps its write and the Notifications it raises in one
// transaction. Every function takes the database first and `now` last, so
// tests can hand in an in-memory one.

function isEnrolled(tx: Tx, userId: number, courseId: number) {
  return !!tx
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)))
    .get();
}

/**
 * Enrolls a Student on a course and tells its Instructor with a new_student
 * Notification. Shared by an Individual Purchase and a Seat claim.
 */
export function enrollNewStudent(
  tx: Tx,
  studentId: number,
  courseId: number,
  now: Date
) {
  const enrollment = tx
    .insert(enrollments)
    .values({ userId: studentId, courseId, enrolledAt: now.toISOString() })
    .returning()
    .get();

  const studentRef = userRef(tx, studentId);

  notify(
    tx,
    {
      kind: "new_student",
      data: {
        actor: studentRef,
        object: studentRef,
        target: ref("course", courseId, courseLabel(tx, courseId)),
      },
      url: `/instructor/${courseId}/students`,
      recipients: { courseInstructor: courseId },
    },
    now
  );

  return enrollment;
}

/**
 * A Student makes an Individual Purchase: it records the Purchase, enrolls
 * them, and tells the course's Instructor. Returns null, and records nothing,
 * when they are already enrolled.
 */
export function makeIndividualPurchase(
  db: Db,
  studentId: number,
  courseId: number,
  amountPaid: number,
  country: string | null,
  now: Date
) {
  return db.transaction((tx) => {
    if (isEnrolled(tx, studentId, courseId)) return null;

    const purchase = tx
      .insert(purchases)
      .values({
        userId: studentId,
        courseId,
        amountPaid,
        country,
        createdAt: now.toISOString(),
      })
      .returning()
      .get();

    const enrollment = enrollNewStudent(tx, studentId, courseId, now);
    return { purchase, enrollment };
  });
}

export const SEAT_ON_HOLD =
  "This seat can't be claimed right now. Ask the person who shared it with you.";
export const SEAT_REFUNDED =
  "This seat is no longer available. Ask the person who shared it with you.";

export type ClaimSeatResult =
  | { ok: true; enrollment: typeof enrollments.$inferSelect }
  | { ok: false; error: string };

/**
 * A Student claims the Seat with `code`, which enrolls them on its course.
 * The Team Admin who bought the Team Licence gets a seat_claimed Notification
 * (unless they claimed it themselves) and the course's Instructor gets a
 * new_student one.
 */
export function claimSeat(
  db: Db,
  code: string,
  studentId: number,
  studentCountry: string,
  now: Date
): ClaimSeatResult {
  return db.transaction((tx): ClaimSeatResult => {
    const seat = tx.select().from(coupons).where(eq(coupons.code, code)).get();
    if (!seat) {
      return { ok: false, error: "Coupon not found" };
    }

    if (seat.redeemedByUserId !== null) {
      return { ok: false, error: "Coupon has already been redeemed" };
    }

    const availability = getSeatAvailability(tx, seat);
    if (availability === "on_hold") {
      return { ok: false, error: SEAT_ON_HOLD };
    }
    if (availability === "refunded") {
      return { ok: false, error: SEAT_REFUNDED };
    }

    if (isEnrolled(tx, studentId, seat.courseId)) {
      return { ok: false, error: "You are already enrolled in this course" };
    }

    const teamLicence = tx
      .select()
      .from(purchases)
      .where(eq(purchases.id, seat.purchaseId))
      .get();
    if (!teamLicence) {
      return { ok: false, error: "Coupon not found" };
    }

    if (teamLicence.country && teamLicence.country !== studentCountry) {
      return {
        ok: false,
        error:
          "This coupon can only be redeemed from the same country as the purchaser",
      };
    }

    tx.update(coupons)
      .set({ redeemedByUserId: studentId, redeemedAt: now.toISOString() })
      .where(eq(coupons.id, seat.id))
      .run();

    const enrollment = enrollNewStudent(tx, studentId, seat.courseId, now);

    notify(
      tx,
      {
        kind: "seat_claimed",
        data: {
          actor: userRef(tx, studentId),
          object: ref("seat", seat.id, code),
          target: ref(
            "team_licence",
            teamLicence.id,
            courseLabel(tx, seat.courseId)
          ),
        },
        url: "/team",
        recipients: { user: teamLicence.userId },
      },
      now
    );

    return { ok: true, enrollment };
  });
}
