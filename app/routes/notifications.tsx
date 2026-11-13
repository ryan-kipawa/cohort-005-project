import { data, Form, redirect, useFetcher } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/notifications";
import { db } from "~/db";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { cn } from "~/lib/utils";
import { useRevalidateOnFocus } from "~/lib/use-revalidate-on-focus";
import {
  getNotificationInbox,
  markNotificationsRead,
  openNotification,
  type InboxRow,
} from "~/lib/notifications.server";

const idsSchema = z
  .string()
  .regex(/^\d+(,\d+)*$/, "Invalid notification ids.")
  .transform((value) => value.split(",").map(Number));

const notificationActionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("mark-read"), ids: idsSchema }),
  z.object({ intent: z.literal("open"), ids: idsSchema }),
]);

export function meta() {
  return [{ title: "Notifications — Cadence" }];
}

async function requireUserId(request: Request) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to see your notifications.", {
      status: 401,
    });
  }
  return currentUserId;
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await requireUserId(request);
  const now = new Date();
  // Reading the inbox marks nothing read.
  return {
    inbox: getNotificationInbox(db, currentUserId, now),
    now: now.toISOString(),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await requireUserId(request);
  const parsed = parseFormData(
    await request.formData(),
    notificationActionSchema
  );

  if (!parsed.success) {
    throw data(Object.values(parsed.errors)[0] ?? "Invalid input.", {
      status: 400,
    });
  }

  const { intent, ids } = parsed.data;
  const now = new Date();

  if (intent === "open") {
    const url = openNotification(db, currentUserId, ids, now);
    if (!url) throw data("Notification not found.", { status: 404 });
    throw redirect(url);
  }

  markNotificationsRead(db, currentUserId, ids, now);
  return { success: true };
}

function timeAgo(createdAt: string, now: string): string {
  const minutes = Math.max(
    0,
    Math.floor((new Date(now).getTime() - new Date(createdAt).getTime()) / 60000)
  );
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function NotificationRow({ row, now }: { row: InboxRow; now: string }) {
  const markRead = useFetcher();
  const ids = row.ids.join(",");
  const read = row.read || markRead.state !== "idle";

  return (
    <li className="group flex items-start gap-4 px-5 py-4">
      <span
        className={cn(
          "mt-2 size-2 shrink-0 rounded-full",
          read ? "bg-transparent" : "bg-blue-600"
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            {row.category}
          </span>
          <span className="text-xs text-muted-foreground">
            {timeAgo(row.createdAt, now)}
          </span>
        </div>
        <Form method="post">
          <input type="hidden" name="intent" value="open" />
          <input type="hidden" name="ids" value={ids} />
          <button
            type="submit"
            className={cn(
              "mt-1 block text-left hover:underline",
              !read && "font-semibold"
            )}
          >
            {row.title}
          </button>
        </Form>
        {row.body && (
          <p className="mt-1 text-sm text-muted-foreground">{row.body}</p>
        )}
      </div>
      {!read && (
        <markRead.Form method="post">
          <input type="hidden" name="intent" value="mark-read" />
          <input type="hidden" name="ids" value={ids} />
          <button
            type="submit"
            className="invisible text-xs text-muted-foreground hover:underline group-hover:visible"
          >
            Mark read
          </button>
        </markRead.Form>
      )}
    </li>
  );
}

function Section({
  title,
  rows,
  now,
}: {
  title: string;
  rows: InboxRow[];
  now: string;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <ul className="divide-y rounded-lg border bg-card">
        {rows.map((row) => (
          <NotificationRow key={row.ids.join(",")} row={row} now={now} />
        ))}
      </ul>
    </section>
  );
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  useRevalidateOnFocus();
  const { inbox, now } = loaderData;
  const isEmpty = inbox.today.length === 0 && inbox.earlier.length === 0;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-6 text-2xl font-bold">Notifications</h1>
      <Section title="Today" rows={inbox.today} now={now} />
      <Section title="Earlier" rows={inbox.earlier} now={now} />
      {isEmpty && (
        <p className="py-16 text-center text-muted-foreground">
          You're all caught up.
        </p>
      )}
    </div>
  );
}
