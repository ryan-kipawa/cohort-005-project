import { useState } from "react";
import { useFetcher } from "react-router";
import { Lock, NotebookPen } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { cn, formatRelativeTime } from "~/lib/utils";
import { describeNoteDraft, type NoteDraft } from "~/modules/lesson-notes";

export type SavedNote = { body: string; updatedAt: string } | null;

// Laid out like CommentThread so the two read as one section at the bottom of
// the lesson.
export function LessonNote({ note }: { note: SavedNote }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [body, setBody] = useState(note?.body ?? "");
  const isSaving = fetcher.state !== "idle";
  const error = fetcher.state === "idle" ? fetcher.data?.error : undefined;
  const draft = describeNoteDraft(body, note?.body ?? null);

  return (
    <Card className="mb-8">
      <CardContent className="p-6">
        <NoteHeader />

        <fetcher.Form method="post" className="space-y-2">
          <input type="hidden" name="intent" value="save-note" />
          <Textarea
            name="body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={4}
            placeholder="Jot down what you want to remember from this lesson..."
            aria-label="Your notes"
            className="resize-y"
          />
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              size="sm"
              disabled={isSaving || !draft.canSave}
            >
              {isSaving ? "Saving..." : "Save note"}
            </Button>
            <NoteStatus
              error={error}
              draft={draft}
              isSaving={isSaving}
              updatedAt={note?.updatedAt}
            />
            <span
              className={cn(
                "ml-auto text-xs",
                draft.tooLong ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {draft.length} / {draft.limit}
            </span>
          </div>
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

// Save is disabled for an empty or over-long draft, so the status says why.
function NoteStatus({
  error,
  draft,
  isSaving,
  updatedAt,
}: {
  error: string | undefined;
  draft: NoteDraft;
  isSaving: boolean;
  updatedAt: string | undefined;
}) {
  if (error) return <span className="text-sm text-destructive">{error}</span>;
  if (draft.unsaved && !isSaving)
    return (
      <span
        className={cn(
          "text-xs",
          draft.canSave ? "text-muted-foreground" : "text-destructive"
        )}
      >
        {unsavedMessage(draft)}
      </span>
    );
  if (!updatedAt) return null;
  return (
    <span suppressHydrationWarning className="text-xs text-muted-foreground">
      Saved {formatRelativeTime(updatedAt)}
    </span>
  );
}

function unsavedMessage(draft: NoteDraft) {
  if (draft.empty) return "Write something to save your note";
  if (draft.tooLong) return "Too long to save";
  return "Unsaved changes";
}

function NoteHeader() {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <NotebookPen className="size-5 text-primary" />
        <h2 className="text-xl font-semibold">Your notes</h2>
      </div>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Lock className="size-3" />
        Only you can see these
      </span>
    </div>
  );
}
