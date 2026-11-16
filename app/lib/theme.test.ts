import { describe, expect, it } from "vitest";
import { applyTheme, THEME_STORAGE_KEY } from "./theme";

function fakeRoot() {
  const classes = new Set<string>();
  return {
    classes,
    classList: {
      toggle(token: string, force: boolean) {
        if (force) classes.add(token);
        else classes.delete(token);
      },
    },
  };
}

function fakeStorage() {
  const items = new Map<string, string>();
  return {
    items,
    setItem: (key: string, value: string) => items.set(key, value),
  };
}

describe("applyTheme", () => {
  it("is stored under the key root.tsx reads", () => {
    expect(THEME_STORAGE_KEY).toBe("cadence-theme");
  });

  it("switches to dark and remembers it", () => {
    const root = fakeRoot();
    const storage = fakeStorage();

    applyTheme(true, root, storage);

    expect([...root.classes]).toEqual(["dark"]);
    expect([...storage.items]).toEqual([["cadence-theme", "dark"]]);
  });

  it("switches back to light and remembers it", () => {
    const root = fakeRoot();
    const storage = fakeStorage();

    applyTheme(true, root, storage);
    applyTheme(false, root, storage);

    expect([...root.classes]).toEqual([]);
    expect([...storage.items]).toEqual([["cadence-theme", "light"]]);
  });

  it("still switches the page when storage refuses the write", () => {
    const root = fakeRoot();
    const storage = {
      setItem() {
        throw new Error("QuotaExceededError");
      },
    };

    expect(() => applyTheme(true, root, storage)).not.toThrow();
    expect([...root.classes]).toEqual(["dark"]);
  });
});
