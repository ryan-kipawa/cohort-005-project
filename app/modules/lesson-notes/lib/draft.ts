import { MAX_NOTE_LENGTH } from "~/lib/notes";

export type NoteDraft = {
  length: number;
  limit: number;
  tooLong: boolean;
  empty: boolean;
  unsaved: boolean;
  canSave: boolean;
};

export function describeDraft(
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
