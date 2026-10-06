import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  UserRoundCheck,
  UserRoundSearch,
  type LucideIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { EmailVerification, EnrichmentStatus, VerificationStatus } from "@/types/enrichment"

const PROVIDER_NAMES: Record<string, string> = {
  prospeo: "Prospeo",
  hunter: "Hunter",
}

/** "prospeo" → "Prospeo". Unknown providers are shown as stored. */
export function providerName(id: string) {
  return PROVIDER_NAMES[id] ?? id
}

const SUCCESS = "border-success/30 bg-success/10 text-success"
const WARNING = "border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning"
const DANGER = "border-destructive/30 bg-destructive/5 text-destructive"
const NEUTRAL = "border-border bg-muted/60 text-muted-foreground"

const ENRICHMENT: Record<EnrichmentStatus, { label: string; icon: LucideIcon; style: string; spin?: boolean }> = {
  not_enriched: { label: "Not Enriched", icon: CircleDashed, style: NEUTRAL },
  enriching: { label: "Finding Decision Maker...", icon: Loader2, style: NEUTRAL, spin: true },
  enriched: { label: "Decision Maker Found", icon: UserRoundCheck, style: SUCCESS },
  partial: { label: "Partial Contact Data", icon: UserRoundSearch, style: WARNING },
  no_match: { label: "No Match Found", icon: CircleHelp, style: NEUTRAL },
  failed: { label: "Enrichment Failed", icon: CircleAlert, style: DANGER },
}

export function EnrichmentStatusBadge({ status, className }: { status: EnrichmentStatus; className?: string }) {
  const { label, icon: Icon, style, spin } = ENRICHMENT[status]
  return (
    <Badge variant="outline" className={cn("gap-1 font-normal", style, className)}>
      <Icon className={cn(spin && "animate-spin")} aria-hidden /> {label}
    </Badge>
  )
}

const VERIFICATION: Record<VerificationStatus, { label: string; icon: LucideIcon; style: string }> = {
  deliverable: { label: "Deliverable", icon: ShieldCheck, style: SUCCESS },
  risky: { label: "Risky", icon: ShieldAlert, style: WARNING },
  invalid: { label: "Invalid", icon: ShieldX, style: DANGER },
  unknown: { label: "Unknown", icon: ShieldQuestion, style: NEUTRAL },
}

export function verificationLabel(status: VerificationStatus) {
  return VERIFICATION[status].label
}

/**
 * The verifier's verdict. The provider is always named, so an email is only
 * ever shown as "Hunter: Deliverable" when Hunter actually checked it.
 */
export function VerificationBadge({
  verification,
  className,
}: {
  verification: EmailVerification
  className?: string
}) {
  const { label, icon: Icon, style } = VERIFICATION[verification.status]
  return (
    <Badge variant="outline" className={cn("gap-1 font-normal", style, className)}>
      <Icon aria-hidden />
      {providerName(verification.provider)}: {label}
    </Badge>
  )
}

export function NotVerifiedBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1 font-normal", NEUTRAL, className)}>
      <CircleDashed aria-hidden /> Not verified
    </Badge>
  )
}

/** The enrichment provider's own claim about an email — shown separately from a verification. */
export function ProviderEmailStatus({ provider, status }: { provider: string; status: string | null }) {
  if (!status) return null
  const verified = status.toUpperCase() === "VERIFIED"
  const Icon = verified ? CircleCheck : CircleX
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className={cn("size-3", verified && "text-success")} aria-hidden />
      {providerName(provider)} status: {status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()}
    </span>
  )
}
