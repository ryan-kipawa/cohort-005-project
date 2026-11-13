// ─── Notification catalogue ───
// Every kind of Notification, and the only place a Notification's text is
// produced. A Notification stores facts (`NotificationData`), never wording;
// the renderer for its kind turns them into a title and body when it is read
// (docs/adr/0013). The inbox uses these renderers now and a push relay will
// later.
//
// Adding a kind means adding one entry to `catalogue`. When two cases need
// different wording, they are two kinds, never a flag in `data`.
//
// Changing a renderer changes the text of every existing Notification of that
// kind, so a renderer must cope with any `data` ever written for its kind.

export const ENTITY_TYPES = [
  "user",
  "course",
  "lesson",
  "lesson_thread",
  "reply",
  "refund_request",
  "individual_purchase",
  "team_licence",
  "seat",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

/** A thing a Notification mentions. The label is captured when it is raised. */
export type Ref = { type: EntityType; id: number; label: string };

export type NotificationData = {
  actor: Ref;
  object: Ref;
  target?: Ref;
  excerpt?: string;
  change?: { from: string; to: string };
};

export type NotificationCategory = "Money" | "Courses" | "Discussion" | "Account";

export type RenderedNotification = { title: string; body?: string };

export type CatalogueEntry = {
  category: NotificationCategory;
  /** The entity types `data.object` may be. */
  object: readonly EntityType[];
  /** The entity types `data.target` may be. Omit when the kind has no target. */
  target?: readonly EntityType[];
  /**
   * Notifications of a grouped kind that share a target collapse into one
   * inbox row while they share a read state.
   */
  groupBy?: "target";
  /**
   * `data` is the newest Notification in the row. `group` is every
   * Notification behind the row, newest first (just `[data]` when ungrouped).
   */
  render: (data: NotificationData, group: NotificationData[]) => RenderedNotification;
};

function capitalise(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export const catalogue = {
  role_changed: {
    category: "Account",
    object: ["user"],
    render: (data) => {
      const change = data.change;
      if (!change) return { title: "Your role was changed" };
      return {
        title: `Your role was changed from ${capitalise(change.from)} to ${capitalise(change.to)}`,
        body: `${data.actor.label} changed your role. What you can do on Cadence has changed with it.`,
      };
    },
  },
  // Refund Requests. `object` is the Refund Request, labelled with the
  // course title; `target` is the Purchase it is for, whose type says whether
  // it was an Individual Purchase or a Team Licence.
  refund_request_raised: {
    category: "Money",
    object: ["refund_request"],
    target: ["individual_purchase", "team_licence"],
    render: (data) => ({
      title: `${data.actor.label} asked for a refund on ${data.object.label}`,
      body: data.excerpt,
    }),
  },
  refund_request_approved: {
    category: "Money",
    object: ["refund_request"],
    target: ["individual_purchase", "team_licence"],
    render: (data) => {
      const course = data.object.label;
      const ended =
        data.target?.type === "team_licence"
          ? `The Unclaimed Seats on your Team Licence for ${course} can no longer be claimed.`
          : `Your Enrollment in ${course} has ended.`;
      return {
        title: `Your refund for ${course} was approved`,
        body: `${ended} The full amount you paid is on its way back to you.`,
      };
    },
  },
  refund_request_declined: {
    category: "Money",
    object: ["refund_request"],
    target: ["individual_purchase", "team_licence"],
    render: (data) => ({
      title: `Your refund for ${data.object.label} was declined`,
      body: data.excerpt,
    }),
  },
  course_status_changed: {
    category: "Courses",
    object: ["course"],
    render: (data) => {
      const change = data.change;
      if (!change) return { title: `${data.object.label} had its status changed` };
      return {
        title: `${data.object.label} was moved from ${capitalise(change.from)} to ${capitalise(change.to)}`,
        body: `${data.actor.label} changed the status of your course.`,
      };
    },
  },
  course_archived: {
    category: "Courses",
    object: ["course"],
    render: (data) => ({ title: `${data.object.label} was archived` }),
  },
} satisfies Record<string, CatalogueEntry>;

export type NotificationKind = keyof typeof catalogue;

export function isNotificationKind(kind: string): kind is NotificationKind {
  return Object.hasOwn(catalogue, kind);
}

export function catalogueEntry(kind: NotificationKind): CatalogueEntry {
  return catalogue[kind];
}
