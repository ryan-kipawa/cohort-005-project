// PROTOTYPE — throwaway. Fake Notifications from the v1 catalogue (map #1, ticket #3),
// stored in the activity shape decided in ticket #5, rendered lazily by a
// catalogue-style renderer. No DB, no persistence. Read state is fake (ticket #7
// owns the lifecycle).

type Ref = { type: string; id: number; label: string };

export type ProtoNotification = {
  id: number;
  kind: Kind;
  data: {
    actor: Ref;
    object: Ref;
    target?: Ref;
    excerpt?: string;
    change?: { from: string; to: string };
  };
  url: string;
  groupKey: string | null;
  minutesAgo: number;
  read: boolean;
};

export type Kind =
  | "refund_request_raised"
  | "refund_request_approved"
  | "refund_request_declined"
  | "seat_claimed"
  | "new_student"
  | "lesson_thread_started"
  | "lesson_thread_reply"
  | "lesson_thread_answer"
  | "post_deleted"
  | "course_status_changed"
  | "course_archived"
  | "role_changed";

export type Category = "Money" | "Courses" | "Discussion" | "Account";

type Rendered = { title: string; body?: string };

export const catalogue: Record<
  Kind,
  { category: Category; render: (d: ProtoNotification["data"], count: number) => Rendered }
> = {
  refund_request_raised: {
    category: "Money",
    render: (d) => ({
      title: `${d.actor.label} requested a refund for ${d.target!.label}`,
      body: d.excerpt,
    }),
  },
  refund_request_approved: {
    category: "Money",
    render: (d) => ({
      title: `Your refund for ${d.target!.label} was approved`,
      body: d.excerpt,
    }),
  },
  refund_request_declined: {
    category: "Money",
    render: (d) => ({
      title: `Your refund request for ${d.target!.label} was declined`,
      body: d.excerpt ? `“${d.excerpt}”` : undefined,
    }),
  },
  seat_claimed: {
    category: "Money",
    render: (d) => ({
      title: `${d.actor.label} claimed a Seat on ${d.target!.label}`,
      body: "Your Team Licence can no longer be refunded.",
    }),
  },
  new_student: {
    category: "Courses",
    render: (d, count) => ({
      title:
        count > 1
          ? `${d.actor.label} and ${count - 1} others joined ${d.target!.label}`
          : `${d.actor.label} joined ${d.target!.label}`,
    }),
  },
  lesson_thread_started: {
    category: "Discussion",
    render: (d) => ({
      title: `${d.actor.label} asked a question on ${d.target!.label}`,
      body: d.excerpt,
    }),
  },
  lesson_thread_reply: {
    category: "Discussion",
    render: (d) => ({
      title: `${d.actor.label} replied to your question on ${d.target!.label}`,
      body: d.excerpt,
    }),
  },
  lesson_thread_answer: {
    category: "Discussion",
    render: (d) => ({
      title: `${d.actor.label} answered your question on ${d.target!.label}`,
      body: d.excerpt,
    }),
  },
  post_deleted: {
    category: "Discussion",
    render: (d) => ({
      title: `${d.actor.label} deleted your post on ${d.target!.label}`,
      body: d.excerpt ? `“${d.excerpt}”` : undefined,
    }),
  },
  course_status_changed: {
    category: "Courses",
    render: (d) => ({
      title: `${d.object.label} is now ${d.change!.to}`,
      body: `Changed from ${d.change!.from} by ${d.actor.label}`,
    }),
  },
  course_archived: {
    category: "Courses",
    render: (d) => ({
      title: `${d.object.label} has been archived`,
      body: "You can still watch the lessons you've already started.",
    }),
  },
  role_changed: {
    category: "Account",
    render: (d) => ({
      title: `You are now an ${d.change!.to}`,
      body: `${d.actor.label} changed your role from ${d.change!.from}`,
    }),
  },
};

const u = (id: number, label: string): Ref => ({ type: "user", id, label });
const course = (id: number, label: string): Ref => ({ type: "course", id, label });
const lesson = (id: number, label: string): Ref => ({ type: "lesson", id, label });

const TS = course(1, "Introduction to TypeScript");
const NODE = course(2, "Building REST APIs with Node.js");
const DOCKER = course(5, "Shipping with Docker and Kubernetes");

let nextId = 1;
const n = (
  kind: Kind,
  data: ProtoNotification["data"],
  url: string,
  minutesAgo: number,
  read = false,
  groupKey: string | null = null
): ProtoNotification => ({ id: nextId++, kind, data, url, groupKey, minutesAgo, read });

const student = [
  n("lesson_thread_answer", { actor: u(2, "Sarah Chen"), object: { type: "reply", id: 41, label: "reply" }, target: lesson(7, "Generics Basics"), excerpt: "Good catch: `T extends object` is what you want there, because…" }, "/courses/introduction-to-typescript/lessons/7#reply-41", 4),
  n("lesson_thread_reply", { actor: u(6, "James Park"), object: { type: "reply", id: 42, label: "reply" }, target: lesson(7, "Generics Basics"), excerpt: "I had the same issue, restarting the TS server fixed it for me" }, "/courses/introduction-to-typescript/lessons/7#reply-42", 38),
  n("refund_request_declined", { actor: u(1, "Alex Rivera"), object: { type: "refund_request", id: 3, label: "Refund Request" }, target: NODE, excerpt: "You've watched more than the Watch Limit allows for a refund." }, "/courses/building-rest-apis-with-nodejs", 60 * 5),
  n("course_archived", { actor: u(4, "Priya Nair"), object: DOCKER }, "/courses/shipping-with-docker-and-kubernetes", 60 * 26, true),
  n("post_deleted", { actor: u(2, "Sarah Chen"), object: { type: "reply", id: 12, label: "reply" }, target: lesson(3, "Your First TypeScript Program"), excerpt: "lol this course is so easy" }, "/courses/introduction-to-typescript/lessons/3", 60 * 50, true),
  n("refund_request_approved", { actor: u(1, "Alex Rivera"), object: { type: "refund_request", id: 2, label: "Refund Request" }, target: course(4, "Practical Data Visualisation"), excerpt: "Your Enrollment has ended." }, "/dashboard", 60 * 24 * 6, true),
];

const teamAdmin = [
  n("seat_claimed", { actor: u(7, "Olivia Martinez"), object: { type: "seat", id: 9, label: "Seat" }, target: TS }, "/team", 12),
  n("seat_claimed", { actor: u(8, "Liam Thompson"), object: { type: "seat", id: 10, label: "Seat" }, target: TS }, "/team", 60 * 3, true),
];

const instructor = [
  n("new_student", { actor: u(5, "Emma Wilson"), object: u(5, "Emma Wilson"), target: TS }, "/instructor/1/students", 2, false, "new_student:course:1"),
  n("new_student", { actor: u(6, "James Park"), object: u(6, "James Park"), target: TS }, "/instructor/1/students", 20, false, "new_student:course:1"),
  n("new_student", { actor: u(9, "Sophia Davis"), object: u(9, "Sophia Davis"), target: TS }, "/instructor/1/students", 55, false, "new_student:course:1"),
  n("lesson_thread_started", { actor: u(5, "Emma Wilson"), object: { type: "lesson_thread", id: 21, label: "thread" }, target: lesson(7, "Generics Basics"), excerpt: "Why does `keyof T` give me string | number | symbol here?" }, "/courses/introduction-to-typescript/lessons/7#thread-21", 9),
  n("lesson_thread_started", { actor: u(7, "Olivia Martinez"), object: { type: "lesson_thread", id: 22, label: "thread" }, target: lesson(12, "Mapped Types"), excerpt: "Is there a way to make only some keys optional?" }, "/courses/introduction-to-typescript/lessons/12#thread-22", 60 * 2),
  n("course_status_changed", { actor: u(1, "Alex Rivera"), object: TS, change: { from: "Draft", to: "Published" } }, "/instructor/1", 60 * 30, true),
  n("new_student", { actor: u(8, "Liam Thompson"), object: u(8, "Liam Thompson"), target: TS }, "/instructor/1/students", 60 * 30, true, "new_student:course:1"),
];

const admin = [
  n("refund_request_raised", { actor: u(9, "Sophia Davis"), object: { type: "refund_request", id: 5, label: "Refund Request" }, target: NODE, excerpt: "Individual Purchase · $49" }, "/admin/refunds", 6),
  n("refund_request_raised", { actor: u(10, "Bossy McBossface"), object: { type: "refund_request", id: 6, label: "Refund Request" }, target: TS, excerpt: "Team Licence · 10 Seats · $390" }, "/admin/refunds", 60 * 4),
  n("role_changed", { actor: u(11, "Another Admin"), object: u(1, "Alex Rivera"), change: { from: "Instructor", to: "Platform Admin" } }, "/admin/users", 60 * 24 * 12, true),
];

export function notificationsFor(role: string, isTeamAdmin: boolean): ProtoNotification[] {
  const list =
    role === "admin" ? admin : role === "instructor" ? instructor : student;
  return [...list, ...(isTeamAdmin ? teamAdmin : [])].sort(
    (a, b) => a.minutesAgo - b.minutesAgo
  );
}

/** Collapse rows sharing a groupKey (unread with unread, read with read). */
export type Grouped = ProtoNotification & { count: number; rendered: Rendered };
export function group(list: ProtoNotification[]): Grouped[] {
  const out: Grouped[] = [];
  const byKey = new Map<string, Grouped>();
  for (const item of list) {
    const key = item.groupKey ? `${item.groupKey}:${item.read}` : null;
    const existing = key ? byKey.get(key) : undefined;
    if (existing) {
      existing.count++;
      existing.rendered = catalogue[existing.kind].render(existing.data, existing.count);
      continue;
    }
    const g: Grouped = { ...item, count: 1, rendered: catalogue[item.kind].render(item.data, 1) };
    out.push(g);
    if (key) byKey.set(key, g);
  }
  return out;
}

export function ago(minutes: number) {
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 60 / 24)}d`;
}

/** A fresh one, for the "simulate arrival" button. */
export function simulated(role: string): ProtoNotification {
  if (role === "admin")
    return n("refund_request_raised", { actor: u(6, "James Park"), object: { type: "refund_request", id: 99, label: "Refund Request" }, target: TS, excerpt: "Individual Purchase · $39" }, "/admin/refunds", 0);
  if (role === "instructor")
    return n("lesson_thread_started", { actor: u(6, "James Park"), object: { type: "lesson_thread", id: 99, label: "thread" }, target: lesson(14, "Conditional Types"), excerpt: "What does `infer` actually do?" }, "/courses/introduction-to-typescript/lessons/14#thread-99", 0);
  return n("lesson_thread_answer", { actor: u(2, "Sarah Chen"), object: { type: "reply", id: 99, label: "reply" }, target: lesson(12, "Mapped Types"), excerpt: "Yes! Use `Partial<Pick<T, K>> & Omit<T, K>`." }, "/courses/introduction-to-typescript/lessons/12#reply-99", 0);
}
