"use client"

import { useCallback, useOptimistic, useTransition } from "react"
import { toast } from "sonner"
import { deleteLeadsAction } from "@/lib/leads/actions"
import {
  addTagAction,
  addToListAction,
  createListAction,
  removeFromListAction,
  removeTagAction,
  updateLeadsAction,
} from "@/lib/pipeline/actions"
import { PRIORITY_LABELS, STAGE_LABELS } from "@/lib/pipeline/config"
import type { LeadOverviewRow } from "@/types/database"
import type { ActionResult, LeadList, LeadPatch, LeadTag } from "@/types/pipeline"

type Change<Row> = { ids: ReadonlySet<string>; apply: (row: Row) => Row }

const FAILED = "Something went wrong. Please try again."

function plural(count: number, one = "lead", many = "leads") {
  return `${count} ${count === 1 ? one : many}`
}

/** A LeadPatch as the row fields it changes, for showing the result before the server answers. */
function toRowFields(patch: LeadPatch, userId: string): Partial<LeadOverviewRow> {
  const fields: Partial<LeadOverviewRow> = {}
  if (patch.stage !== undefined) fields.pipeline_stage = patch.stage
  if (patch.priority !== undefined) fields.priority = patch.priority
  if (patch.contactStatus !== undefined) fields.contact_status = patch.contactStatus
  if (patch.followUpAt !== undefined) {
    fields.follow_up_at = patch.followUpAt
    if (patch.followUpAt === null) fields.follow_up_note = null
  }
  if (patch.followUpNote !== undefined && patch.followUpAt !== null) fields.follow_up_note = patch.followUpNote
  if (patch.assignToMe !== undefined) fields.assigned_to = patch.assignToMe ? userId : null
  if (patch.estimatedValue !== undefined) fields.estimated_value = patch.estimatedValue
  if (patch.actualValue !== undefined) fields.actual_value = patch.actualValue
  return fields
}

function describe(patch: LeadPatch, count: number) {
  const leads = plural(count)
  if (patch.archived === true) return `${leads} archived.`
  if (patch.archived === false) return `${leads} restored.`
  if (patch.stage) return `${leads} moved to ${STAGE_LABELS[patch.stage]}.`
  if (patch.priority) return `Priority set to ${PRIORITY_LABELS[patch.priority]} for ${leads}.`
  if (patch.followUpAt === null) return `Follow-up cleared for ${leads}.`
  if (patch.followUpAt) return `Follow-up set for ${leads}.`
  if (patch.assignToMe === true) return `${leads} assigned to you.`
  if (patch.assignToMe === false) return `${leads} unassigned.`
  return `${leads} updated.`
}

/**
 * Every change a user can make to leads from the table, the board or the
 * detail page. Non-destructive changes show immediately and roll back by
 * themselves if the server rejects them; destructive ones wait for the server.
 */
export function useLeadActions<Row extends LeadOverviewRow>(serverRows: Row[], currentUserId: string) {
  const [rows, applyChange] = useOptimistic(serverRows, (state: Row[], change: Change<Row>) =>
    state.map((row) => (change.ids.has(row.id) ? change.apply(row) : row))
  )
  const [pending, startTransition] = useTransition()

  /**
   * Runs an action inside a transition. The optimistic rows stay on screen
   * until the server's refreshed data arrives, and revert if it failed.
   */
  const run = useCallback(
    <T,>(
      ids: string[],
      optimistic: ((row: Row) => Row) | null,
      action: () => Promise<ActionResult<T>>,
      success?: (result: { ok: true } & T) => string | null
    ) =>
      new Promise<boolean>((resolve) => {
        startTransition(async () => {
          if (optimistic) applyChange({ ids: new Set(ids), apply: optimistic })
          const result = await action().catch(() => null)
          if (!result?.ok) {
            toast.error(result?.message ?? FAILED)
            return resolve(false)
          }
          const message = success?.(result)
          if (message) toast.success(message)
          resolve(true)
        })
      }),
    [applyChange]
  )

  /** Stage, priority, follow-up, assignee, archive… Quiet for one lead, confirmed by a toast for several. */
  const update = useCallback(
    (ids: string[], patch: LeadPatch, options: { announce?: boolean } = {}) => {
      // Archiving and restoring remove rows from the current view, so they wait for the server.
      const optimistic = patch.archived === undefined ? (row: Row) => ({ ...row, ...toRowFields(patch, currentUserId) }) : null
      const announce = options.announce ?? (ids.length > 1 || patch.archived !== undefined)
      return run(ids, optimistic, () => updateLeadsAction(ids, patch), (result) =>
        announce ? describe(patch, result.updated) : null
      )
    },
    [run, currentUserId]
  )

  const addToList = useCallback(
    (list: LeadList, ids: string[]) =>
      run(
        ids,
        (row) => (row.list_ids.includes(list.id) ? row : { ...row, list_ids: [...row.list_ids, list.id] }),
        () => addToListAction(list.id, ids),
        (result) =>
          result.added === 0
            ? `${ids.length === 1 ? "This lead is" : "These leads are"} already in “${list.name}”.`
            : `${plural(result.added)} added to “${list.name}”.${result.alreadyIn ? ` ${result.alreadyIn} already there.` : ""}`
      ),
    [run]
  )

  const removeFromList = useCallback(
    (list: LeadList, ids: string[]) =>
      run(
        ids,
        (row) => ({ ...row, list_ids: row.list_ids.filter((id) => id !== list.id) }),
        () => removeFromListAction(list.id, ids),
        () => `Removed from “${list.name}”.`
      ),
    [run]
  )

  /** Creates a list and puts the given leads in it. */
  const createList = useCallback(
    (name: string, ids: string[]) =>
      run(ids, null, () => createListAction({ name }, ids), (result) =>
        ids.length ? `List “${result.list.name}” created with ${plural(result.list.count)}.` : `List “${result.list.name}” created.`
      ),
    [run]
  )

  const addTag = useCallback(
    (tag: LeadTag, ids: string[]) =>
      run(
        ids,
        (row) => (row.tag_ids.includes(tag.id) ? row : { ...row, tag_ids: [...row.tag_ids, tag.id] }),
        () => addTagAction({ id: tag.id }, ids),
        () => (ids.length > 1 ? `Tag “${tag.name}” added to ${plural(ids.length)}.` : null)
      ),
    [run]
  )

  /** Applies a tag by name, creating it when the user doesn't have it yet. */
  const createTag = useCallback(
    (name: string, ids: string[]) =>
      run(ids, null, () => addTagAction({ name }, ids), (result) => `Tag “${result.tag.name}” added to ${plural(ids.length)}.`),
    [run]
  )

  const removeTag = useCallback(
    (tag: LeadTag, ids: string[]) =>
      run(
        ids,
        (row) => ({ ...row, tag_ids: row.tag_ids.filter((id) => id !== tag.id) }),
        () => removeTagAction(tag.id, ids),
        () => (ids.length > 1 ? `Tag “${tag.name}” removed from ${plural(ids.length)}.` : null)
      ),
    [run]
  )

  /** Permanent deletion. Never optimistic. */
  const remove = useCallback(
    (ids: string[]) =>
      run(ids, null, () => deleteLeadsAction(ids), (result) => `${plural(result.removed)} permanently deleted.`),
    [run]
  )

  return { rows, pending, update, addToList, removeFromList, createList, addTag, createTag, removeTag, remove }
}

export type LeadActions = ReturnType<typeof useLeadActions>
