import { eq } from "drizzle-orm";
import { users, type UserRole } from "~/db/schema";
import { notify, type Db } from "~/lib/notifications.server";

// ─── Users ───
// Account changes a Platform Admin makes. Every function takes the database
// first and `now` last, so tests can hand in an in-memory one.

/**
 * A Platform Admin changes someone's role. The person whose role changed gets
 * a role_changed Notification, unless they changed it themselves.
 * Returns the updated user, or null when there is no such user.
 */
export function changeUserRole(
  db: Db,
  platformAdminId: number,
  userId: number,
  role: UserRole,
  now: Date
) {
  return db.transaction((tx) => {
    const user = tx.select().from(users).where(eq(users.id, userId)).get();
    if (!user) return null;

    const updated = tx
      .update(users)
      .set({ role })
      .where(eq(users.id, userId))
      .returning()
      .get();

    if (user.role === role) return updated;

    const platformAdmin = tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, platformAdminId))
      .get();

    notify(
      tx,
      platformAdminId,
      "role_changed",
      {
        actor: {
          type: "user",
          id: platformAdminId,
          label: platformAdmin?.name ?? "A Platform Admin",
        },
        object: { type: "user", id: user.id, label: user.name },
        change: { from: user.role, to: role },
      },
      "/dashboard",
      { user: user.id },
      now
    );

    return updated;
  });
}
