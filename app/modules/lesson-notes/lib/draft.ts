import { MAX_NOTE_LENGTH } from "~/lib/notes";

export type NoteDraft = {
  length: number;
  limit: number;
  tooLong: boolean;
  empty: boolean;
  unsaved: boolean;
  canSave: boolean;
};

/**
 * What the lesson note editor should show for the text in the box, given the
 * note the server last saved (`null` when there is none yet).
 */
export function describeNoteDraft(
  draft: string,
  savedBody: string | null
): NoteDraft {
  const trimmed = draft.trim();
  const empty = trimmed.length === 0;
  const tooLong = trimmed.length > MAX_NOTE_LENGTH;
  // The server trims before it stores, so whitespace alone is not a change.
  const unsaved = trimmed !== (savedBody ?? "");

  return {
    length: trimmed.length,
    limit: MAX_NOTE_LENGTH,
    tooLong,
    empty,
    unsaved,
    canSave: unsaved && !empty && !tooLong,
  };
}
