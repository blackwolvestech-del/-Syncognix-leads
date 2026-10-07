"use client"

import { useState, useTransition } from "react"
import { ListPlus, Loader2, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EmptyState } from "@/components/shared/empty-state"
import { createListAction, deleteListAction, renameListAction } from "@/lib/pipeline/actions"
import { PIPELINE_CONFIG } from "@/lib/pipeline/config"
import { toLocalInputValue } from "@/lib/pipeline/follow-up"
import type { LeadList } from "@/types/pipeline"

const { limits } = PIPELINE_CONFIG

/** Asks for one short name (a new list or tag). Stays open until `onSubmit` resolves true. */
export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  maxLength,
  submitLabel,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  label: string
  placeholder?: string
  maxLength: number
  submitLabel: string
  onSubmit: (name: string) => Promise<boolean>
}) {
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const value = name.trim()
    if (!value || saving) return
    setSaving(true)
    const done = await onSubmit(value)
    setSaving(false)
    if (done) {
      setName("")
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="name-dialog-input">{label}</Label>
            <Input
              id="name-dialog-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={placeholder}
              maxLength={maxLength}
              autoFocus
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Sets, changes or clears a follow-up date and note for one or several leads. */
export function FollowUpDialog({
  target,
  onOpenChange,
  onSave,
}: {
  /** Null closes the dialog. */
  target: { count: number; name?: string; followUpAt: string | null; note: string | null } | null
  onOpenChange: (open: boolean) => void
  onSave: (followUpAt: string | null, note: string | null) => void
}) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {/* Keyed so the form starts from the lead it was opened for. */}
        {target && <FollowUpForm key={`${target.name}:${target.followUpAt}`} target={target} onOpenChange={onOpenChange} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  )
}

function FollowUpForm({
  target,
  onOpenChange,
  onSave,
}: {
  target: { count: number; name?: string; followUpAt: string | null; note: string | null }
  onOpenChange: (open: boolean) => void
  onSave: (followUpAt: string | null, note: string | null) => void
}) {
  const [when, setWhen] = useState(() => toLocalInputValue(target.followUpAt))
  const [note, setNote] = useState(target.note ?? "")
  const date = when ? new Date(when) : null
  const valid = date !== null && !Number.isNaN(date.getTime())

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid) return
    // The input is in the browser's time zone; it is stored as an absolute time.
    onSave(date.toISOString(), note.trim() || null)
    onOpenChange(false)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{target.followUpAt ? "Change follow-up" : "Set follow-up"}</DialogTitle>
        <DialogDescription>
          {target.count === 1 ? (target.name ?? "This lead") : `${target.count} leads`}. Follow-ups are shown in
          your lead views; no reminder is sent.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="follow-up-when">Date and time</Label>
        <Input
          id="follow-up-when"
          type="datetime-local"
          value={when}
          onChange={(event) => setWhen(event.target.value)}
          required
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="follow-up-note">Note (optional)</Label>
        <Input
          id="follow-up-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. Call owner, send website audit"
          maxLength={limits.followUpNote}
          autoComplete="off"
        />
      </div>
      <DialogFooter className="gap-2 sm:justify-between">
        {target.followUpAt ? (
          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => {
              onSave(null, null)
              onOpenChange(false)
            }}
          >
            Clear follow-up
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid}>
            Save
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}

/** Create, rename and delete lists. Deleting a list never deletes its leads. */
export function ListsDialog({
  open,
  onOpenChange,
  lists,
  onOpenList,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  lists: LeadList[]
  /** Shows the leads of a list (applies the list filter). */
  onOpenList: (list: LeadList) => void
}) {
  const [name, setName] = useState("")
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function act(action: () => Promise<{ ok: boolean; message?: string }>, success: string, after?: () => void) {
    startTransition(async () => {
      const result = await action().catch(() => null)
      if (!result?.ok) return void toast.error(result?.message ?? "Something went wrong. Please try again.")
      toast.success(success)
      after?.()
    })
  }

  function create(event: React.FormEvent) {
    event.preventDefault()
    const value = name.trim()
    if (!value) return
    act(() => createListAction({ name: value }), `List “${value}” created.`, () => setName(""))
  }

  function rename(event: React.FormEvent) {
    event.preventDefault()
    if (!editing?.name.trim()) return
    const { id, name: next } = editing
    act(() => renameListAction(id, { name: next }), "List renamed.", () => setEditing(null))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Lead lists</DialogTitle>
          <DialogDescription>
            Organize prospects by campaign, service, location or industry. A lead can be in several lists.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={create} className="flex gap-2">
          <Label htmlFor="new-list-name" className="sr-only">
            New list name
          </Label>
          <Input
            id="new-list-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New list, e.g. Roofers — Dallas"
            maxLength={limits.listName}
            autoComplete="off"
          />
          <Button type="submit" disabled={pending || !name.trim()}>
            <ListPlus /> Create
          </Button>
        </form>

        {lists.length === 0 ? (
          <EmptyState
            icon={ListPlus}
            title="No lead lists yet."
            description="Create a list to organize prospects by campaign, service, location, or industry."
            className="py-8"
          />
        ) : (
          <ul className="-mx-2 max-h-80 divide-y overflow-y-auto">
            {lists.map((list) => (
              <li key={list.id} className="px-2 py-2">
                {editing?.id === list.id ? (
                  <form onSubmit={rename} className="flex gap-2">
                    <Input
                      value={editing.name}
                      onChange={(event) => setEditing({ id: list.id, name: event.target.value })}
                      maxLength={limits.listName}
                      aria-label={`New name for ${list.name}`}
                      autoFocus
                      autoComplete="off"
                      className="h-8"
                    />
                    <Button type="submit" size="sm" disabled={pending || !editing.name.trim()}>
                      Save
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : deleting === list.id ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 text-pretty">
                      Delete “{list.name}”? Its {list.count} {list.count === 1 ? "lead stays" : "leads stay"} saved.
                    </span>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={pending}
                      onClick={() => act(() => deleteListAction(list.id), `List “${list.name}” deleted.`, () => setDeleting(null))}
                    >
                      Delete
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onOpenList(list)}
                      className="min-w-0 flex-1 rounded-sm text-left text-sm outline-none hover:underline hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <span className="block truncate font-medium">{list.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {list.count} {list.count === 1 ? "lead" : "leads"}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Rename ${list.name}`}
                      onClick={() => {
                        setDeleting(null)
                        setEditing({ id: list.id, name: list.name })
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${list.name}`}
                      onClick={() => {
                        setEditing(null)
                        setDeleting(list.id)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
