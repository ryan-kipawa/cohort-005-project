import { CheckCheck } from "lucide-react";
import {
  data,
  Form,
  Link,
  redirect,
  useFetcher,
  useNavigate,
} from "react-router";
import { z } from "zod";
import type { Route } from "./+types/notifications";
import { db } from "~/db";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { cn } from "~/lib/utils";
import { useRevalidateOnFocus } from "~/lib/use-revalidate-on-focus";
import {
  getNotificationInboxPage,
  INBOX_PAGE_SIZE,
  markAllNotificationsRead,
  markNotificationsRead,
  NOTIFICATION_CATEGORIES,
  openNotification,
  type InboxRow,
} from "~/lib/notifications.server";

const idsSchema = z
  .string()
  .regex(/^\d+(,\d+)*$/, "Invalid notification ids.")
  .transform((value) => value.split(",").map(Number));

const categorySchema = z.enum(NOTIFICATION_CATEGORIES);

const notificationActionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("mark-read"), ids: idsSchema }),
  z.object({ intent: z.literal("open"), ids: idsSchema }),
  z.object({
    intent: z.literal("mark-all-read"),
    category: categorySchema.optional(),
  }),
]);

/** The inbox filters, kept in the URL. Anything unrecognised falls back to the default. */
const inboxFiltersSchema = z.object({
  category: categorySchema.optional().catch(undefined),
  unread: z
    .literal("1")
    .optional()
    .catch(undefined)
    .transform((value) => value === "1"),
  page: z.coerce.number().int().min(1).max(100).catch(1),
});

type InboxSearch = { category?: string; unread: boolean; page: number };

function inboxHref({ category, unread, page }: InboxSearch): string {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (unread) params.set("unread", "1");
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `?${search}` : "?";
}

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
  const url = new URL(request.url);
  const filters = inboxFiltersSchema.parse(
    Object.fromEntries(url.searchParams)
  );
  const now = new Date();
  // Reading the inbox marks nothing read.
  return {
    inbox: getNotificationInboxPage(db, currentUserId, now, {
      category: filters.category,
      unreadOnly: filters.unread,
      limit: filters.page * INBOX_PAGE_SIZE,
    }),
    filters,
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

  const now = new Date();

  switch (parsed.data.intent) {
    case "open": {
      const url = openNotification(db, currentUserId, parsed.data.ids, now);
      if (!url) throw data("Notification not found.", { status: 404 });
      throw redirect(url);
    }
    case "mark-read":
      markNotificationsRead(db, currentUserId, parsed.data.ids, now);
      return { success: true };
    case "mark-all-read":
      markAllNotificationsRead(db, currentUserId, parsed.data.category, now);
      return { success: true };
  }
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
  const { inbox, filters, now } = loaderData;
  const navigate = useNavigate();
  const isEmpty = inbox.today.length === 0 && inbox.earlier.length === 0;
  const hasUnread = [...inbox.today, ...inbox.earlier].some((row) => !row.read);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notifications</h1>
        {(hasUnread || inbox.hasMore) && (
          <Form method="post">
            <input type="hidden" name="intent" value="mark-all-read" />
            {filters.category && (
              <input type="hidden" name="category" value={filters.category} />
            )}
            <button
              type="submit"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:underline"
            >
              <CheckCheck className="size-4" /> Mark all as read
            </button>
          </Form>
        )}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {([undefined, ...inbox.categories] as const).map((category) => (
          <Link
            key={category ?? "All"}
            to={inboxHref({ category, unread: filters.unread, page: 1 })}
            preventScrollReset
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              filters.category === category
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-accent"
            )}
          >
            {category ?? "All"}
          </Link>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={filters.unread}
            onChange={(event) =>
              navigate(
                inboxHref({
                  category: filters.category,
                  unread: event.target.checked,
                  page: 1,
                }),
                { preventScrollReset: true }
              )
            }
          />
          Unread only
        </label>
      </div>

      <Section title="Today" rows={inbox.today} now={now} />
      <Section title="Earlier" rows={inbox.earlier} now={now} />
      {isEmpty && (
        <p className="py-16 text-center text-muted-foreground">
          You're all caught up.
        </p>
      )}
      {inbox.hasMore && (
        <div className="text-center">
          <Link
            to={inboxHref({ ...filters, page: filters.page + 1 })}
            preventScrollReset
            className="text-sm text-muted-foreground hover:underline"
          >
            Load more
          </Link>
        </div>
      )}
    </div>
  );
}
