export const UNREAD_POLL_INTERVAL_MS = 60_000;

/** The text on the sidebar's unread badge, or null when the badge is hidden. */
export function unreadBadgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

type VisibleDocument = EventTarget & {
  visibilityState: DocumentVisibilityState;
};

/**
 * Calls `refresh` when the window regains focus, when the tab becomes visible
 * again, and every 60 seconds while the tab is visible. Never polls a hidden
 * tab. Returns a function that stops watching.
 */
export function watchUnreadCount(
  refresh: () => void,
  env: { window: EventTarget; document: VisibleDocument }
): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;

  function startPolling() {
    if (timer === undefined) {
      timer = setInterval(refresh, UNREAD_POLL_INTERVAL_MS);
    }
  }

  function stopPolling() {
    clearInterval(timer);
    timer = undefined;
  }

  function onVisibilityChange() {
    if (env.document.visibilityState === "visible") {
      refresh();
      startPolling();
    } else {
      stopPolling();
    }
  }

  if (env.document.visibilityState === "visible") startPolling();
  env.window.addEventListener("focus", refresh);
  env.document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    stopPolling();
    env.window.removeEventListener("focus", refresh);
    env.document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
