export type { Lead, LeadOverviewRow, LeadStatus, Profile, SearchHistoryEntry } from "./database"

/** The signed-in user as consumed by UI components. */
export type AppUser = {
  id: string
  email: string
  fullName: string
  firstName: string
  initials: string
  avatarUrl: string | null
}

/** Shared return shape for form server actions. */
export type ActionState = {
  status: "idle" | "error" | "success"
  message?: string
  fieldErrors?: Record<string, string>
  /** Echo of submitted values so the form can be restored after an error. */
  values?: Record<string, string>
}
