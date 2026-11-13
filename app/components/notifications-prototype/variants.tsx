// PROTOTYPE — throwaway. Question (map #1, ticket #6): how do Notifications look
// and where do they appear? Four variants on the real app layout, switch with
// ?variant=A|B|C|D:
//   A  Bell + dropdown only (no inbox page)
//   B  Inbox page only (sidebar nav item, full page, filters)
//   C  Toasts + slide-over drawer (live arrivals toast; history in a drawer)
//   D  Hybrid: bell dropdown (latest few) → "See all" inbox page; toasts only for
//      a handful of "you'll want to know now" kinds
// Data is fake (fixtures.ts) and nothing persists.

import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Bell, BellDot, CheckCheck, Inbox, X, Zap } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  ago,
  catalogue,
  group,
  notificationsFor,
  simulated,
  type Category,
  type Grouped,
  type Kind,
  type ProtoNotification,
} from "./fixtures";

export const VARIANTS = {
  A: "Bell + dropdown",
  B: "Inbox page",
  C: "Toasts + drawer",
  D: "Hybrid: bell → inbox, selective toasts",
} as const;
export type VariantKey = keyof typeof VARIANTS;

const TOAST_KINDS_D: Kind[] = [
  "refund_request_approved",
  "refund_request_declined",
  "lesson_thread_answer",
  "refund_request_raised",
];

export type Slots = {
  header?: ReactNode;
  nav?: ReactNode;
  footer?: ReactNode;
  main?: ReactNode; // replaces <Outlet/> when set
  overlay?: ReactNode;
};

function useProtoState(role: string, isTeamAdmin: boolean) {
  const [items, setItems] = useState<ProtoNotification[]>(() =>
    notificationsFor(role, isTeamAdmin)
  );
  const unread = items.filter((i) => !i.read).length;
  const markRead = (ids: number[]) =>
    setItems((xs) => xs.map((x) => (ids.includes(x.id) ? { ...x, read: true } : x)));
  const markAll = () => setItems((xs) => xs.map((x) => ({ ...x, read: true })));
  const arrive = () => {
    const fresh = simulated(role);
    setItems((xs) => [fresh, ...xs.map((x) => ({ ...x, minutesAgo: x.minutesAgo + 1 }))]);
    return fresh;
  };
  return { items, unread, markRead, markAll, arrive };
}

/* ---------- shared bits (small on purpose) ---------- */

function idsOf(g: Grouped, all: ProtoNotification[]) {
  return g.groupKey
    ? all.filter((x) => x.groupKey === g.groupKey && x.read === g.read).map((x) => x.id)
    : [g.id];
}

function UnreadBadge({ n, className }: { n: number; className?: string }) {
  if (n === 0) return null;
  return (
    <span
      className={cn(
        "min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white",
        className
      )}
    >
      {n > 9 ? "9+" : n}
    </span>
  );
}

function SimulateButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="PROTOTYPE: simulate a Notification arriving"
      className="fixed right-4 top-4 z-50 flex items-center gap-1 rounded-full border border-dashed border-amber-500 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 shadow dark:bg-amber-950 dark:text-amber-200"
    >
      <Zap className="size-3" /> Simulate arrival
    </button>
  );
}

/* ---------- Variant A: bell + dropdown ---------- */

function VariantA({ s }: { s: ReturnType<typeof useProtoState> }): Slots {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const grouped = group(s.items);
  return {
    header: (
      <div className="relative ml-auto">
        <button
          onClick={() => setOpen((o) => !o)}
          className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent"
          title="Notifications"
        >
          {s.unread ? <BellDot className="size-5" /> : <Bell className="size-5" />}
          <UnreadBadge n={s.unread} className="absolute -right-1 -top-1" />
        </button>
        {open && (
          <div className="absolute left-full top-0 z-40 ml-3 w-96 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <span className="text-sm font-semibold">Notifications</span>
              <button onClick={s.markAll} className="text-xs text-muted-foreground hover:underline">
                Mark all as read
              </button>
            </div>
            <ul className="max-h-[70vh] divide-y overflow-y-auto">
              {grouped.map((g) => (
                <li key={g.id}>
                  <button
                    onClick={() => {
                      s.markRead(idsOf(g, s.items));
                      setOpen(false);
                      navigate(g.url.split("#")[0] + "?variant=A");
                    }}
                    className={cn(
                      "flex w-full gap-3 px-4 py-3 text-left hover:bg-accent",
                      !g.read && "bg-primary/5"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        g.read ? "bg-transparent" : "bg-blue-600"
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm", !g.read && "font-medium")}>
                        {g.rendered.title}
                      </span>
                      {g.rendered.body && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {g.rendered.body}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{ago(g.minutesAgo)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    ),
    overlay: <SimulateButton onClick={s.arrive} />,
  };
}

/* ---------- Variant B: inbox page ---------- */

function InboxPage({
  s,
  variant,
}: {
  s: ReturnType<typeof useProtoState>;
  variant: VariantKey;
}) {
  const [cat, setCat] = useState<Category | "All">("All");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const navigate = useNavigate();
  const grouped = group(s.items).filter(
    (g) =>
      (cat === "All" || catalogue[g.kind].category === cat) && (!unreadOnly || !g.read)
  );
  const cats = useMemo(
    () => Array.from(new Set(s.items.map((i) => catalogue[i.kind].category))),
    [s.items]
  );
  const today = grouped.filter((g) => g.minutesAgo < 60 * 24);
  const earlier = grouped.filter((g) => g.minutesAgo >= 60 * 24);

  const Section = ({ title, rows }: { title: string; rows: Grouped[] }) =>
    rows.length === 0 ? null : (
      <section className="mb-8">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        <ul className="divide-y rounded-lg border bg-card">
          {rows.map((g) => (
            <li key={g.id} className="group flex items-start gap-4 px-5 py-4">
              <span
                className={cn(
                  "mt-2 size-2 shrink-0 rounded-full",
                  g.read ? "bg-transparent" : "bg-blue-600"
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                    {catalogue[g.kind].category}
                  </span>
                  <span className="text-xs text-muted-foreground">{ago(g.minutesAgo)} ago</span>
                </div>
                <button
                  onClick={() => {
                    s.markRead(idsOf(g, s.items));
                    navigate(g.url.split("#")[0] + `?variant=${variant}`);
                  }}
                  className={cn("mt-1 block text-left hover:underline", !g.read && "font-semibold")}
                >
                  {g.rendered.title}
                </button>
                {g.rendered.body && (
                  <p className="mt-1 text-sm text-muted-foreground">{g.rendered.body}</p>
                )}
              </div>
              {!g.read && (
                <button
                  onClick={() => s.markRead(idsOf(g, s.items))}
                  className="invisible text-xs text-muted-foreground hover:underline group-hover:visible"
                >
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <button onClick={s.markAll} className="flex items-center gap-1 text-sm text-muted-foreground hover:underline">
          <CheckCheck className="size-4" /> Mark all as read
        </button>
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(["All", ...cats] as const).map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              cat === c ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"
            )}
          >
            {c}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          Unread only
        </label>
      </div>
      <Section title="Today" rows={today} />
      <Section title="Earlier" rows={earlier} />
      {grouped.length === 0 && (
        <p className="py-16 text-center text-muted-foreground">You're all caught up.</p>
      )}
    </div>
  );
}

function InboxNavItem({ unread, variant, active }: { unread: number; variant: VariantKey; active: boolean }) {
  const [, setParams] = useSearchParams();
  return (
    <button
      onClick={() => setParams({ variant, view: "inbox" })}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
    >
      <Inbox className="size-4" />
      Notifications
      <UnreadBadge n={unread} className="ml-auto" />
    </button>
  );
}

function VariantB({ s, inbox }: { s: ReturnType<typeof useProtoState>; inbox: boolean }): Slots {
  return {
    nav: <InboxNavItem unread={s.unread} variant="B" active={inbox} />,
    main: inbox ? <InboxPage s={s} variant="B" /> : undefined,
    overlay: <SimulateButton onClick={s.arrive} />,
  };
}

/* ---------- Variant C: toasts + drawer ---------- */

function VariantC({ s }: { s: ReturnType<typeof useProtoState> }): Slots {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const grouped = group(s.items);
  const onArrive = () => {
    const fresh = s.arrive();
    const r = catalogue[fresh.kind].render(fresh.data, 1);
    toast(r.title, {
      description: r.body,
      action: { label: "View", onClick: () => navigate(fresh.url.split("#")[0] + "?variant=C") },
    });
  };
  return {
    footer: (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent"
      >
        <Bell className="size-4" /> Notifications
        <UnreadBadge n={s.unread} className="ml-auto" />
      </button>
    ),
    overlay: (
      <>
        <SimulateButton onClick={onArrive} />
        {open && (
          <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={() => setOpen(false)}>
            <aside
              onClick={(e) => e.stopPropagation()}
              className="flex h-full w-[28rem] flex-col bg-background shadow-2xl"
            >
              <div className="flex items-center justify-between border-b px-5 py-4">
                <h2 className="font-semibold">Notifications</h2>
                <div className="flex items-center gap-3">
                  <button onClick={s.markAll} className="text-xs text-muted-foreground hover:underline">
                    Mark all as read
                  </button>
                  <button onClick={() => setOpen(false)}>
                    <X className="size-4" />
                  </button>
                </div>
              </div>
              <ul className="flex-1 space-y-2 overflow-y-auto p-4">
                {grouped.map((g) => (
                  <li
                    key={g.id}
                    className={cn(
                      "cursor-pointer rounded-lg border p-3 hover:bg-accent",
                      !g.read && "border-l-4 border-l-blue-600"
                    )}
                    onClick={() => {
                      s.markRead(idsOf(g, s.items));
                      setOpen(false);
                      navigate(g.url.split("#")[0] + "?variant=C");
                    }}
                  >
                    <div className="flex justify-between gap-2 text-sm">
                      <span className={cn(!g.read && "font-medium")}>{g.rendered.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{ago(g.minutesAgo)}</span>
                    </div>
                    {g.rendered.body && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{g.rendered.body}</p>
                    )}
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        )}
      </>
    ),
  };
}

/* ---------- Variant D: hybrid ---------- */

function VariantD({ s, inbox }: { s: ReturnType<typeof useProtoState>; inbox: boolean }): Slots {
  const [open, setOpen] = useState(false);
  const [, setParams] = useSearchParams();
  const navigate = useNavigate();
  const latest = group(s.items).slice(0, 5);
  const onArrive = () => {
    const fresh = s.arrive();
    if (!TOAST_KINDS_D.includes(fresh.kind)) return;
    const r = catalogue[fresh.kind].render(fresh.data, 1);
    toast(r.title, {
      description: r.body,
      action: { label: "View", onClick: () => navigate(fresh.url.split("#")[0] + "?variant=D") },
    });
  };
  return {
    header: (
      <div className="relative ml-auto">
        <button
          onClick={() => setOpen((o) => !o)}
          className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent"
        >
          <Bell className="size-5" />
          <UnreadBadge n={s.unread} className="absolute -right-1 -top-1" />
        </button>
        {open && (
          <div className="absolute left-full top-0 z-40 ml-3 w-80 rounded-lg border bg-popover text-popover-foreground shadow-xl">
            <div className="border-b px-4 py-2.5 text-sm font-semibold">Latest</div>
            <ul className="divide-y">
              {latest.map((g) => (
                <li key={g.id}>
                  <button
                    onClick={() => {
                      s.markRead(idsOf(g, s.items));
                      setOpen(false);
                      navigate(g.url.split("#")[0] + "?variant=D");
                    }}
                    className="flex w-full gap-2 px-4 py-2.5 text-left text-sm hover:bg-accent"
                  >
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", g.read ? "bg-transparent" : "bg-blue-600")} />
                    <span className={cn("flex-1", !g.read && "font-medium")}>{g.rendered.title}</span>
                    <span className="text-xs text-muted-foreground">{ago(g.minutesAgo)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={() => {
                setOpen(false);
                setParams({ variant: "D", view: "inbox" });
              }}
              className="block w-full border-t px-4 py-2.5 text-center text-sm font-medium text-primary hover:bg-accent"
            >
              See all notifications
            </button>
          </div>
        )}
      </div>
    ),
    main: inbox ? <InboxPage s={s} variant="D" /> : undefined,
    overlay: <SimulateButton onClick={onArrive} />,
  };
}

/* ---------- entry ---------- */

export function useNotificationPrototype(
  variant: VariantKey,
  role: string | null,
  isTeamAdmin: boolean
): Slots {
  const [params] = useSearchParams();
  const inbox = params.get("view") === "inbox";
  // keyed by role so switching DevUI user resets the fake data
  const s = useProtoState(role ?? "student", isTeamAdmin);
  if (!role) return {};
  // Each variant is a hook-ish function; call all so hook order is stable.
  const a = VariantA({ s });
  const b = VariantB({ s, inbox });
  const c = VariantC({ s });
  const d = VariantD({ s, inbox });
  return { A: a, B: b, C: c, D: d }[variant];
}
