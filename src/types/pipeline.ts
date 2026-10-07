/** Types shared by the server and the browser for Step 5 (pipeline and lead management). */

import type { ContactStatus, PipelineStage, Priority } from "@/lib/pipeline/config"

export interface LeadList {
  id: string
  name: string
  description: string | null
  /** Leads in the list. */
  count: number
}

export interface LeadTag {
  id: string
  name: string
}

export interface LeadNote {
  id: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface LeadActivityEntry {
  id: string
  action: string
  metadata: Record<string, unknown>
  createdAt: string
}

/** A change to one or more leads. Only the keys that are present are changed. */
export interface LeadPatch {
  stage?: PipelineStage
  priority?: Priority
  contactStatus?: ContactStatus
  /** ISO timestamp, or null to clear the follow-up. */
  followUpAt?: string | null
  followUpNote?: string | null
  /** True assigns to the signed-in user; false unassigns. */
  assignToMe?: boolean
  archived?: boolean
  estimatedValue?: number | null
  actualValue?: number | null
}

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; message: string }
