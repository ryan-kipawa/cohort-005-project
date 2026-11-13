import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { unreadBadgeLabel, watchUnreadCount } from "./unread-badge";

describe("the unread badge label", () => {
  it("is hidden when nothing is unread", () => {
    expect(unreadBadgeLabel(0)).toBeNull();
  });

  it("shows the count up to 99", () => {
    expect(unreadBadgeLabel(1)).toBe("1");
    expect(unreadBadgeLabel(99)).toBe("99");
  });

  it("shows 99+ above 99", () => {
    expect(unreadBadgeLabel(100)).toBe("99+");
    expect(unreadBadgeLabel(1234)).toBe("99+");
  });
});

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
  hide() {
    this.visibilityState = "hidden";
    this.dispatchEvent(new Event("visibilitychange"));
  }
  show() {
    this.visibilityState = "visible";
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

describe("watching the unread count", () => {
  let win: EventTarget;
  let doc: FakeDocument;
  let refresh: ReturnType<typeof vi.fn<() => void>>;
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    win = new EventTarget();
    doc = new FakeDocument();
    refresh = vi.fn<() => void>();
  });

  afterEach(() => {
    stop?.();
    vi.useRealTimers();
  });

  it("refreshes when the window regains focus", () => {
    stop = watchUnreadCount(refresh, { window: win, document: doc });
    expect(refresh).not.toHaveBeenCalled();

    win.dispatchEvent(new Event("focus"));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes every 60 seconds while the tab is visible", () => {
    stop = watchUnreadCount(refresh, { window: win, document: doc });

    vi.advanceTimersByTime(59_999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("doesn't poll while the tab is hidden, and refreshes when it is shown again", () => {
    stop = watchUnreadCount(refresh, { window: win, document: doc });

    doc.hide();
    vi.advanceTimersByTime(5 * 60_000);
    expect(refresh).not.toHaveBeenCalled();

    doc.show();
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("doesn't start polling in a tab that opens hidden", () => {
    doc.visibilityState = "hidden";
    stop = watchUnreadCount(refresh, { window: win, document: doc });

    vi.advanceTimersByTime(5 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops refreshing once stopped", () => {
    stop = watchUnreadCount(refresh, { window: win, document: doc });
    stop();

    win.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(5 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
