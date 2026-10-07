"use server"

import type { PostgrestError } from "@supabase/supabase-js"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type { Database, LeadPipelineFields } from "@/types/database"
import type { ActionResult, LeadList, LeadNote, LeadPatch, LeadTag } from "@/types/pipeline"
import { CONTACT_STATUSES, PIPELINE_CONFIG, PIPELINE_STAGES, PRIORITIES } from "./config"

/*
 * Every write for Step 5. Each action re-reads the user from the session,
 * validates its input, and answers with a message that is safe to show —
 * database errors are logged on the server and never sent to the browser.
 * Activity history is written by database triggers in the same transaction
 * as the change itself, so the two can't drift apart.
 */

const { limits, maxBulk } = PIPELINE_CONFIG

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MISSING_CODES = new Set(["42P01", "PGRST205", "42703", "PGRST204"])
const UNIQUE_VIOLATION = "23505"
/** Ids travel in the request URL, so large selections are sent in batches. */
const BATCH = 100

const SIGNED_OUT = "Your session has expired. Please sign in again."
const NOT_SET_UP = "Lead management isn't set up yet. Run the 20261008 migration in Supabase, then try again."
const INVALID = "That request wasn't valid. Please refresh the page and try again."

const fail = (message: string) => ({ ok: false as const, message })

function dbFailure(error: PostgrestError, scope: string, fallback: string) {
  if (MISSING_CODES.has(error.code ?? "")) return fail(NOT_SET_UP)
  console.error(`[pipeline] ${scope} failed: ${error.code ?? "unknown"} ${error.message}`)
  return fail(fallback)
}

async function getSession() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  return { supabase, userId: data?.claims?.sub ?? null }
}

function validIds(ids: unknown): string[] | null {
  if (!Array.isArray(ids)) return null
  const unique = [...new Set(ids)]
  if (unique.length === 0 || unique.length > maxBulk) return null
  return unique.every((id) => typeof id === "string" && UUID.test(id)) ? (unique as string[]) : null
}

function cleanName(value: unknown, max: number) {
  if (typeof value !== "string") return null
  const text = value.replace(/\s+/g, " ").trim()
  return text && text.length <= max ? text : null
}

function batches(ids: string[]) {
  const groups: string[][] = []
  for (let start = 0; start < ids.length; start += BATCH) groups.push(ids.slice(start, start + BATCH))
  return groups
}

function refresh() {
  // "layout" also covers the lead detail pages under /leads.
  revalidatePath("/leads", "layout")
  revalidatePath("/dashboard")
}

// --- pipeline fields -----------------------------------------------------------

function money(value: unknown) {
  if (value === null) return { ok: true as const, value: null }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 9_999_999_999) return { ok: false as const }
  return { ok: true as const, value: Math.round(value * 100) / 100 }
}

/** Turns a LeadPatch into column values. Null when anything in it is invalid. */
function toColumns(patch: LeadPatch, userId: string): Partial<LeadPipelineFields> | null {
  if (!patch || typeof patch !== "object") return null
  const columns: Partial<LeadPipelineFields> = {}

  if (patch.stage !== undefined) {
    if (!PIPELINE_STAGES.includes(patch.stage)) return null
    columns.pipeline_stage = patch.stage
  }
  if (patch.priority !== undefined) {
    if (!PRIORITIES.includes(patch.priority)) return null
    columns.priority = patch.priority
  }
  if (patch.contactStatus !== undefined) {
    if (!CONTACT_STATUSES.includes(patch.contactStatus)) return null
    columns.contact_status = patch.contactStatus
  }
  if (patch.followUpAt !== undefined) {
    if (patch.followUpAt === null) {
      columns.follow_up_at = null
      columns.follow_up_note = null
    } else {
      const time = typeof patch.followUpAt === "string" ? new Date(patch.followUpAt).getTime() : NaN
      if (Number.isNaN(time)) return null
      columns.follow_up_at = new Date(time).toISOString()
    }
  }
  if (patch.followUpNote !== undefined && patch.followUpAt !== null) {
    if (patch.followUpNote !== null && typeof patch.followUpNote !== "string") return null
    columns.follow_up_note = patch.followUpNote?.trim().slice(0, limits.followUpNote) || null
  }
  if (patch.assignToMe !== undefined) columns.assigned_to = patch.assignToMe === true ? userId : null
  if (patch.archived !== undefined) {
    columns.is_archived = patch.archived === true
    columns.archived_at = patch.archived === true ? new Date().toISOString() : null
  }
  if (patch.estimatedValue !== undefined) {
    const value = money(patch.estimatedValue)
    if (!value.ok) return null
    columns.estimated_value = value.value
  }
  if (patch.actualValue !== undefined) {
    const value = money(patch.actualValue)
    if (!value.ok) return null
    columns.actual_value = value.value
  }
  return Object.keys(columns).length ? columns : null
}

/** Changes stage, priority, follow-up, assignee, archive state… on one or many leads. */
export async function updateLeadsAction(ids: string[], patch: LeadPatch): Promise<ActionResult<{ updated: number }>> {
  const leadIds = validIds(ids)
  if (!leadIds) return fail(INVALID)
  const failed = "We couldn't update these leads. Please try again."

  try {
    const { supabase, userId } = await getSession()
    if (!userId) return fail(SIGNED_OUT)
    const columns = toColumns(patch, userId)
    if (!columns) return fail(INVALID)

    let updated = 0
    for (const batch of batches(leadIds)) {
      // RLS enforces ownership; the user_id filter makes the intent explicit.
      const { data, error } = await supabase.from("leads").update(columns).eq("user_id", userId).in("id", batch).select("id")
      if (error) {
        if (updated > 0) {
          refresh()
          return fail(`Only ${updated} of ${leadIds.length} leads were updated. Please try the rest again.`)
        }
        return dbFailure(error, "update leads", failed)
      }
      updated += data?.length ?? 0
    }
    refresh()
    if (updated === 0) return fail("Those leads could not be found. They may have been removed.")
    return { ok: true, updated }
  } catch (error) {
    console.error("[pipeline] update leads action failed:", error)
    return fail(failed)
  }
}

// --- lists -------------------------------------------------------------------

type ListInput = { name: string; description?: string | null }

function listValues(input: ListInput) {
  const name = cleanName(input?.name, limits.listName)
  if (!name) return null
  const description =
    typeof input.description === "string" ? input.description.trim().slice(0, limits.listDescription) || null : null
  return { name, description }
}

const DUPLICATE_LIST = "You already have a list with that name."

/** Creates a list, optionally adding leads to it straight away. */
export async function createListAction(input: ListInput, leadIds: string[] = []): Promise<ActionResult<{ list: LeadList }>> {
  const values = listValues(input)
  if (!values) return fail(`Give the list a name of up to ${limits.listName} characters.`)
  const members = leadIds.length ? validIds(leadIds) : []
  if (!members) return fail(INVALID)
  const failed = "We couldn't create the list. Please try again."

  try {
    const { supabase, userId } = await getSession()
    if (!userId) return fail(SIGNED_OUT)

    const { data, error } = await supabase
      .from("lead_lists")
      .insert({ ...values, user_id: userId })
      .select("id, name, description")
      .single()
    if (error) return error.code === UNIQUE_VIOLATION ? fail(DUPLICATE_LIST) : dbFailure(error, "create list", failed)

    let count = 0
    if (members.length) {
      const added = await addMembers(supabase, userId, data.id, members)
      if (!added.ok) {
        refresh()
        return fail(`The list “${data.name}” was created, but the leads couldn't be added. Please add them again.`)
      }
      count = added.added
    }
    refresh()
    return { ok: true, list: { ...data, count } }
  } catch (error) {
    console.error("[pipeline] create list action failed:", error)
    return fail(failed)
  }
}

export async function renameListAction(id: string, input: ListInput): Promise<ActionResult> {
  const values = listValues(input)
  if (!UUID.test(id ?? "")) return fail(INVALID)
  if (!values) return fail(`Give the list a name of up to ${limits.listName} characters.`)
  const failed = "We couldn't rename the list. Please try again."

  try {
    const { supabase, userId } = await getSession()
    if (!userId) return fail(SIGNED_OUT)
    const { error } = await supabase.from("lead_lists").update(values).eq("id", id).eq("user_id", userId)
    if (error) return error.code === UNIQUE_VIOLATION ? fail(DUPLICATE_LIST) : dbFailure(error, "rename list", failed)
    refresh()
    return { ok: true }
  } catch (error) {
    console.error("[pipeline] rename list action failed:", error)
    return fail(failed)
  }
}

/** Deletes a list. Its leads are kept; only their membership goes. */
export async function deleteListAction(id: string): Promise<ActionResult> {
  if (!UUID.test(id ?? "")) return fail(INVALID)
  const failed = "We couldn't delete the list. Please try again."
  try {
    const { supabase, userId } = await getSession()
    if (!userId) return fail(SIGNED_OUT)
    const { error } = await supabase.from("lead_lists").delete().eq("id", id).eq("user_id", userId)
    if (error) return dbFailure(error, "delete list", failed)
    refresh()
    return { ok: true }
  } catch (error) {
    console.error("[pipeline] delete list action failed:", error)
    return fail(failed)
  }
}

type Session = Awaited<ReturnType<typeof getSession>>["supabase"]

async function addMembers(supabase: Session, userId: string, listId: string, leadIds: string[]) {
  // Leads already in the list are skipped by the (list_id, lead_id) unique constraint.
  const { data, error } = await supabase
    .from("lead_list_members")
    .upsert(
      leadIds.map((leadId) => ({ list_id: listId, lead_id: leadId, user_id: userId })),
      { onConflict: "list_id,lead_id", ignoreDuplicates: true }
    )
    .select("id")
  if (error) return { ok: false as const, error }
  return { ok: true as const, added: data?.length ?? 0 }
}

export async function addToListAction(listId: string, ids: string[]): Promise<ActionResult<{ added: number; alreadyIn: number }>> {
  const leadIds = validIds(ids)
  if (!leadIds || !UUID.test(listId ?? "")) return fail(INVALID)
  const failed = "We couldn't add these leads to the list. Please try again."
  try {
    const { supabase, userId } = await getSession()
    if (!userId) return fail(SIGNED_OUT)
    const result = await addMembers(supabase, userId, listId, leadIds)
    if (!result.ok) return dbFailure(result.error, "add to list", failed)
    refresh()
    return { ok: true, added: result.added, alreadyIn: leadIds.length - result.added }
  } catch (error) {
    console.error("[pipeline] add to list action failed:", error)
    return fail(failed)
  }
}

export async function removeFromListAction(listId: string, ids: string[]): Promise<ActionResult> {
  const leadIds = validIds(ids)
  if (!leadIds || !UUID.test(listId ?? "")) return fail(INVALID)
  const failed = "We couldn't remove these leads from the list. Please try again."
  try {
    const { supabase, userId } = await getSession()
    if (!userId) return fail(SIGNED_OUT)
    for (const batch of batches(leadIds)) {
      const { error } = await supabase
        .from("lead_list_members")
        .delete()
        .eq("user_id", userId)
        .eq("list_id", listId)
        .in("lead_id", batch)
      if (error) return dbFailure(error, "remove from list", failed)
    }
    refresh()
    return { ok: true }
  } catch (error) {
    console.error("[pipeline] remove from list action failed:", error)
    return fail(failed)
  }
}

// --- tags ----------------------------------------------------------------------

/** Finds the user's tag with this name (any capitalization) or creates it. */
async function findOrCreateTag(supabase: Session, userId: string, name: string) {
  const escaped = name.replace(/[\\%_]/g, (char) => `\\${char}`)
  const existing = await supabase.from("tags").select("id, name").eq("user_id", userId).ilike("name", escaped).limit(1)
  if (existing.error) return { error: existing.error }
  if (existing.data?.[0]) return { tag: existing.data[0] as LeadTag }

  const created = await supabase.from("tags").insert({ name, user_id: userId }).select("id, name").single()
  if (created.error) return { error: created.error }
  return { tag: created.data as LeadTag }
}

/** Applies a tag (existing, or a new one by name) to leads. */
export async function addTagAction(
  tag: { id: string } | { name: string },
  ids: string[]
): Promise<ActionResult<{ tag: LeadTag }>> {
  const leadIds = validIds(ids)
  if (!leadIds || !tag || typeof tag !== "object") return fail(INVALID)
  const failed = "We couldn't add the tag. Please try again."

  try {
    const { supabase, userId } = await getSession()
    if (!userId) return fail(SIGNED_OUT)

    let resolved: LeadTag
    if ("id" in tag) {
      if (!UUID.test(tag.id ?? "")) return fail(INVALID)
      const { data, error } = await supabase.from("tags").select("id, name").eq("user_id", userId).eq("id", tag.id).maybeSingle()
      if (error) return dbFailure(error, "load tag", failed)
      if (!data) return fail("That tag no longer exists.")
      resolved = data
    } else {
      const name = cleanName(tag.name, limits.tagName)
      if (!name) return fail(`Give the tag a name of up to ${limits.tagName} characters.`)
      const found = await findOrCreateTag(supabase, userId, name)
      if (found.error) return dbFailure(found.error, "create tag", failed)
      resolved = found.tag
    }

    const { error } = await supabase.from("lead_tags").upsert(
      leadIds.map((leadId) => ({ lead_id: leadId, tag_id: resolved.id, user_id: userId })),
      { onConflict: "lead_id,tag_id", ignoreDuplicates: true }
    )
    if (error) return dbFailure(error, "add tag", failed)
    refresh()
    return { ok: true, tag: resolved }
  } catch (error) {
    console.error("[pipeline] add tag action failed:", error)
    return fail(failed)
  }
}

export async function removeTagAction(tagId: string, ids: string[]): Promise<ActionResult> {
  const leadIds = validIds(ids)
  if (!leadIds || !UUID.test(tagId ?? "")) return fail(INVALID)
  const failed = "We couldn't remove the tag. Please try again."
  try {
    const { supabase, userId } = await getSession()
    if (!userId) return fail(SIGNED_OUT)
    for (const batch of batches(leadIds)) {
      const { error } = await supabase.from("lead_tags").delete().eq("user_id", userId).eq("tag_id", tagId).in("lead_id", batch)
      if (error) return dbFailure(error, "remove tag", failed)
    }
    refresh()
    return { ok: true }
  } catch (error) {
    console.error("[pipeline] remove tag action failed:", error)
    return fail(failed)
  }
}

/** Deletes a tag everywhere. Leads are kept; they just lose the tag. */
export async function deleteTagAction(tagId: string): Promise<ActionResult> {
  if (!UUID.test(tagId ?? "")) return fail(INVALID)
  const failed = "We couldn't delete the tag. Please try again."
  try {
    const { supabase, userId } = await getSession()
    if (!userId) return fail(SIGNED_OUT)
    const { error } = await supabase.from("tags").delete().eq("id", tagId).eq("user_id", userId)
    if (error) return dbFailure(error, "delete tag", failed)
    refresh()
    return { ok: true }
  } catch (error) {
    console.error("[pipeline] delete tag action failed:", error)
    return fail(failed)
  }
}

// --- notes -----------------------------------------------------------------------

function noteContent(value: unknown) {
  if (typeof value !== "string") return null
  const text = value.trim()
  return text && text.length <= limits.note ? text : null
}

type NoteRow = Database["public"]["Tables"]["lead_notes"]["Row"]

const toNote = (row: Pick<NoteRow, "id" | "content" | "created_at" | "updated_at">): LeadNote => ({
  id: row.id,
  content: row.content,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const NOTE_LENGTH = `A note needs some text, up to ${limits.note.toLocaleString("en-US")} characters.`

/** Adds a note. Notes are separate rows, so one never overwrites another. */
export async function addNoteAction(leadId: string, content: string): Promise<ActionResult<{ note: LeadNote }>> {
  const text = noteContent(content)
  if (!UUID.test(leadId ?? "")) return fail(INVALID)
  if (!text) return fail(NOTE_LENGTH)
  const failed = "We couldn't save the note. Please try again."
  try {
    const { supabase, userId } = await getSession()
    if (!userId) return fail(SIGNED_OUT)
    const { data, error } = await supabase
      .from("lead_notes")
      .insert({ lead_id: leadId, content: text, user_id: userId })
      .select("id, content, created_at, updated_at")
      .single()
    if (error) return dbFailure(error, "add note", failed)
    refresh()
    return { ok: true, note: toNote(data) }
  } catch (error) {
    console.error("[pipeline] add note action failed:", error)
    return fail(failed)
  }
}

export async function updateNoteAction(noteId: string, content: string): Promise<ActionResult<{ note: LeadNote }>> {
  const text = noteContent(content)
  if (!UUID.test(noteId ?? "")) return fail(INVALID)
  if (!text) return fail(NOTE_LENGTH)
  const failed = "We couldn't save the note. Please try again."
  try {
    const { supabase, userId } = await getSession()
    if (!userId) return fail(SIGNED_OUT)
    const { data, error } = await supabase
      .from("lead_notes")
      .update({ content: text })
      .eq("id", noteId)
      .eq("user_id", userId)
      .select("id, content, created_at, updated_at")
      .maybeSingle()
    if (error) return dbFailure(error, "update note", failed)
    if (!data) return fail("That note no longer exists.")
    refresh()
    return { ok: true, note: toNote(data) }
  } catch (error) {
    console.error("[pipeline] update note action failed:", error)
    return fail(failed)
  }
}

export async function deleteNoteAction(noteId: string): Promise<ActionResult> {
  if (!UUID.test(noteId ?? "")) return fail(INVALID)
  const failed = "We couldn't delete the note. Please try again."
  try {
    const { supabase, userId } = await getSession()
    if (!userId) return fail(SIGNED_OUT)
    const { error } = await supabase.from("lead_notes").delete().eq("id", noteId).eq("user_id", userId)
    if (error) return dbFailure(error, "delete note", failed)
    refresh()
    return { ok: true }
  } catch (error) {
    console.error("[pipeline] delete note action failed:", error)
    return fail(failed)
  }
}
