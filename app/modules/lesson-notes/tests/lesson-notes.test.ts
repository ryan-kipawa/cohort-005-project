import { describe, it, expect } from "vitest";
import { describeNoteDraft } from "../index";
import { MAX_NOTE_LENGTH } from "~/lib/notes";

describe("describeNoteDraft", () => {
  it("cannot save an empty box when there is no note", () => {
    const draft = describeNoteDraft("", null);
    expect(draft).toMatchObject({
      length: 0,
      empty: true,
      unsaved: false,
      canSave: false,
    });
  });

  it("can save new text when there is no note", () => {
    const draft = describeNoteDraft("Narrow with a type guard", null);
    expect(draft).toMatchObject({
      length: 24,
      empty: false,
      unsaved: true,
      tooLong: false,
      canSave: true,
    });
  });

  it("has nothing to save when the text matches the saved note", () => {
    const draft = describeNoteDraft("Same note", "Same note");
    expect(draft.unsaved).toBe(false);
    expect(draft.canSave).toBe(false);
  });

  it("ignores surrounding whitespace, as the server trims it", () => {
    const draft = describeNoteDraft("  Same note \n", "Same note");
    expect(draft.length).toBe(9);
    expect(draft.unsaved).toBe(false);
    expect(draft.canSave).toBe(false);
  });

  it("treats whitespace alone as empty", () => {
    const draft = describeNoteDraft("   \n ", "Old note");
    expect(draft.empty).toBe(true);
    expect(draft.unsaved).toBe(true);
    expect(draft.canSave).toBe(false);
  });

  it("can save an edit to an existing note", () => {
    const draft = describeNoteDraft("New note", "Old note");
    expect(draft.unsaved).toBe(true);
    expect(draft.canSave).toBe(true);
  });

  it("allows a note exactly at the limit", () => {
    const draft = describeNoteDraft("a".repeat(MAX_NOTE_LENGTH), null);
    expect(draft.limit).toBe(MAX_NOTE_LENGTH);
    expect(draft.tooLong).toBe(false);
    expect(draft.canSave).toBe(true);
  });

  it("refuses a note one character over the limit", () => {
    const draft = describeNoteDraft("a".repeat(MAX_NOTE_LENGTH + 1), null);
    expect(draft.length).toBe(MAX_NOTE_LENGTH + 1);
    expect(draft.tooLong).toBe(true);
    expect(draft.canSave).toBe(false);
  });
});
