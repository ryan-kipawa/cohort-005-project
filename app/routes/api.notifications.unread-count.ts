import { data } from "react-router";
import type { Route } from "./+types/api.notifications.unread-count";
import { db } from "~/db";
import { getCurrentUserId } from "~/lib/session";
import { getUnreadNotificationCount } from "~/lib/notifications.server";

/** The signed-in user's unread count, as the sidebar badge shows it. */
export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to see your notifications.", {
      status: 401,
    });
  }
  return { count: getUnreadNotificationCount(db, currentUserId, new Date()) };
}
