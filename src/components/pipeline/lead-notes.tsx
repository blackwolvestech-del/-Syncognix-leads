"use client"

import { useState, useTransition } from "react"
import { Loader2, Pencil, StickyNote, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { addNoteAction, deleteNoteAction, updateNoteAction } from "@/lib/pipeline/actions"
import { PIPELINE_CONFIG, describeActivity } from "@/lib/pipeline/config"
import type { LeadActivityEntry, LeadNote } from "@/types/pipeline"

const TEXTAREA =
  "min-h-20 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"

const dateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })

/** A timestamp in the browser's time zone. The server's rendering of it is replaced on hydration. */
function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {dateTime.format(new Date(iso))}
    </time>
  )
}

const FAILED = "Something went wrong. Please try again."

/** Notes for one lead, oldest first. Every note is kept; editing one never touches another. */
export function LeadNotes({ leadId, notes, author }: { leadId: string; notes: LeadNote[]; author: string }) {
  const [draft, setDraft] = useState("")
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function act(action: () => Promise<{ ok: boolean; message?: string }>, after: () => void) {
    startTransition(async () => {
      const result = await action().catch(() => null)
      if (!result?.ok) return void toast.error(result?.message ?? FAILED)
      after()
    })
  }

  function add(event: React.FormEvent) {
    event.preventDefault()
    const content = draft.trim()
    if (!content) return
    act(() => addNoteAction(leadId, content), () => setDraft(""))
  }

  return (
    <div className="space-y-4">
      {notes.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <StickyNote className="size-4" aria-hidden /> No notes yet.
        </p>
      ) : (
        <ol className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} className="rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <When iso={note.createdAt} />
                <span aria-hidden>·</span>
                <span className="font-medium text-foreground">{author}</span>
                {note.updatedAt !== note.createdAt && <span>(edited)</span>}
                {editing?.id !== note.id && deleting !== note.id && (
                  <span className="ml-auto flex gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Edit note"
                      onClick={() => {
                        setDeleting(null)
                        setEditing({ id: note.id, content: note.content })
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Delete note"
                      onClick={() => {
                        setEditing(null)
                        setDeleting(note.id)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                )}
              </div>

              {editing?.id === note.id ? (
                <form
                  className="mt-2 space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const content = editing.content.trim()
                    if (content) act(() => updateNoteAction(note.id, content), () => setEditing(null))
                  }}
                >
                  <textarea
                    className={TEXTAREA}
                    value={editing.content}
                    onChange={(event) => setEditing({ id: note.id, content: event.target.value })}
                    maxLength={PIPELINE_CONFIG.limits.note}
                    aria-label="Edit note"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={pending || !editing.content.trim()}>
                      Save
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <p className="mt-1.5 text-sm text-pretty whitespace-pre-wrap">{note.content}</p>
              )}

              {deleting === note.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Delete this note?</span>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    onClick={() => act(() => deleteNoteAction(note.id), () => setDeleting(null))}
                  >
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>
                    Cancel
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={add} className="space-y-2">
        <label htmlFor="new-note" className="sr-only">
          Add a note
        </label>
        <textarea
          id="new-note"
          className={TEXTAREA}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a note…"
          maxLength={PIPELINE_CONFIG.limits.note}
        />
        <Button type="submit" size="sm" disabled={pending || !draft.trim()}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Add Note
        </Button>
      </form>
    </div>
  )
}

/** What happened to a lead, newest first. Written by the database alongside each change. */
export function LeadHistory({ activity }: { activity: LeadActivityEntry[] }) {
  if (activity.length === 0) return <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
  return (
    <ol className="space-y-3">
      {activity.map((entry) => (
        <li key={entry.id} className="grid grid-cols-[0.5rem_minmax(0,1fr)] gap-x-3 text-sm">
          <span className="mt-1.5 size-2 rounded-full bg-muted-foreground/40" aria-hidden />
          <div>
            <p className="text-pretty">{describeActivity(entry.action, entry.metadata)}</p>
            <p className="text-xs text-muted-foreground">
              <When iso={entry.createdAt} />
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}
