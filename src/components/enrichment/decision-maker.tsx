"use client"

import { ExternalLink, Loader2, Mail, RotateCcw, ShieldCheck, UserRoundSearch } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Missing } from "@/components/leads/business-cells"
import { cn } from "@/lib/utils"
import type { EnrichmentStatus, LeadEnrichment, ProspectScore } from "@/types/enrichment"
import {
  EnrichmentStatusBadge,
  NotVerifiedBadge,
  ProviderEmailStatus,
  VerificationBadge,
  providerName,
} from "./enrichment-badges"
import { ProspectAnalysis } from "./prospect-score"

export interface DecisionMakerProps {
  status: EnrichmentStatus
  enrichment: LeadEnrichment | undefined
  /** Why the last lookup failed, when status is "failed". */
  failure?: string
  verifying: boolean
  /** True while a bulk run is in progress; single actions wait. */
  disabled?: boolean
  onEnrich: () => void
  onVerify: () => void
}

export function EmailLink({ address, className }: { address: string; className?: string }) {
  return (
    <a
      href={`mailto:${address}`}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className
      )}
    >
      <Mail className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{address}</span>
    </a>
  )
}

export function personName(enrichment: LeadEnrichment | undefined) {
  const person = enrichment?.person
  if (!person) return null
  return person.fullName ?? ([person.firstName, person.lastName].filter(Boolean).join(" ") || null)
}

/** Compact decision-maker block for table rows and cards. */
export function DecisionMakerCell({
  status,
  enrichment,
  failure,
  verifying,
  disabled,
  onEnrich,
  onVerify,
  businessName,
}: DecisionMakerProps & { businessName: string }) {
  if (status === "enriching") {
    return (
      <div className="space-y-1.5" role="status">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Finding decision maker...
        </p>
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-40" />
      </div>
    )
  }

  if (status === "not_enriched" || status === "failed") {
    return (
      <div className="space-y-1.5">
        {status === "failed" && (
          <div>
            <EnrichmentStatusBadge status="failed" />
            {failure && <p className="mt-1 max-w-56 text-xs text-pretty text-muted-foreground">{failure}</p>}
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onEnrich}
          disabled={disabled}
          aria-label={`Find decision maker for ${businessName}`}
        >
          {status === "failed" ? <RotateCcw /> : <UserRoundSearch />}
          {status === "failed" ? "Try Again" : "Find Decision Maker"}
        </Button>
      </div>
    )
  }

  if (status === "no_match" || !enrichment) return <EnrichmentStatusBadge status="no_match" />

  const name = personName(enrichment)
  return (
    <div className="min-w-44 space-y-1">
      <div>
        <p className="font-medium text-foreground">{name ?? "Name not available"}</p>
        {enrichment.person?.title && (
          <p className="text-xs text-muted-foreground">{enrichment.person.title}</p>
        )}
      </div>
      {enrichment.email ? (
        <>
          <EmailLink address={enrichment.email.address} className="max-w-56 text-[13px]" />
          <div className="flex flex-wrap items-center gap-1.5">
            {enrichment.verification ? (
              <VerificationBadge verification={enrichment.verification} />
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={onVerify}
                disabled={verifying || disabled}
                aria-label={`Verify email for ${businessName}`}
              >
                {verifying ? <Loader2 className="animate-spin" aria-hidden /> : <ShieldCheck />}
                {verifying ? "Verifying email..." : "Verify Email"}
              </Button>
            )}
          </div>
        </>
      ) : (
        <EnrichmentStatusBadge status="partial" />
      )}
    </div>
  )
}

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  )
}

/**
 * Prospect Analysis, Decision Maker and Email Verification sections for the
 * details panel. Each action only appears when it applies to the current state.
 */
export function EnrichmentSections({
  prospect,
  status,
  enrichment,
  failure,
  verifying,
  disabled,
  onEnrich,
  onVerify,
}: DecisionMakerProps & { prospect: ProspectScore }) {
  const name = personName(enrichment)
  const person = enrichment?.person
  const canEnrich = status === "not_enriched" || status === "failed"

  return (
    <>
      <section aria-labelledby="details-prospect">
        <SectionTitle id="details-prospect">Prospect analysis</SectionTitle>
        <div className="mt-3">
          <ProspectAnalysis prospect={prospect} />
        </div>
      </section>

      <section aria-labelledby="details-decision-maker">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle id="details-decision-maker">Decision maker</SectionTitle>
          <EnrichmentStatusBadge status={status} />
        </div>

        {status === "enriching" && (
          <div className="mt-3 space-y-2" role="status">
            <p className="text-sm text-muted-foreground">Searching professional contact data...</p>
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        )}

        {canEnrich && (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-pretty text-muted-foreground">
              {status === "failed"
                ? (failure ?? "The last lookup didn't complete.")
                : "Look up the owner or senior decision maker and their work email. This may use Prospeo credits; the result is saved so it's never looked up twice."}
            </p>
            <Button onClick={onEnrich} disabled={disabled} size="sm">
              {status === "failed" ? <RotateCcw /> : <UserRoundSearch />}
              {status === "failed" ? "Try Again" : "Find Decision Maker"}
            </Button>
          </div>
        )}

        {status === "no_match" && (
          <p className="mt-3 text-sm text-pretty text-muted-foreground">
            No decision maker could be found for this business
            {enrichment && <> ({providerName(enrichment.provider)}, {dateFormat.format(new Date(enrichment.enrichedAt))})</>}
            .
          </p>
        )}

        {enrichment && (status === "enriched" || status === "partial") && (
          <dl className="mt-1 divide-y">
            <Row label="Name">{name ?? <Missing />}</Row>
            <Row label="Title">{person?.title ?? <Missing />}</Row>
            <Row label="Work email">
              {enrichment.email ? (
                <div className="space-y-1">
                  <EmailLink address={enrichment.email.address} />
                  <div>
                    <ProviderEmailStatus
                      provider={enrichment.provider}
                      status={enrichment.email.providerStatus}
                    />
                  </div>
                </div>
              ) : (
                <Missing />
              )}
            </Row>
            <Row label="LinkedIn">
              {person?.linkedinUrl ? (
                <a
                  href={person.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  View profile <ExternalLink className="size-3.5" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : (
                <Missing />
              )}
            </Row>
            <Row label="Direct mobile">
              <span className="text-muted-foreground/70">Not available in Free Version</span>
            </Row>
            <Row label="Source">{providerName(enrichment.provider)}</Row>
            <Row label="Found on">{dateFormat.format(new Date(enrichment.enrichedAt))}</Row>
          </dl>
        )}
      </section>

      {enrichment?.email && (
        <section aria-labelledby="details-verification">
          <SectionTitle id="details-verification">Email verification</SectionTitle>
          {enrichment.verification ? (
            <dl className="mt-1 divide-y">
              <Row label="Status">
                <VerificationBadge verification={enrichment.verification} />
              </Row>
              <Row label="Verified by">{providerName(enrichment.verification.provider)}</Row>
              {enrichment.verification.providerStatus && (
                <Row label="Provider result">
                  {enrichment.verification.providerStatus}
                  {enrichment.verification.score !== null && (
                    <span className="text-muted-foreground"> · score {enrichment.verification.score}</span>
                  )}
                </Row>
              )}
              <Row label="Verified on">
                {dateFormat.format(new Date(enrichment.verification.verifiedAt))}
              </Row>
            </dl>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-2">
                <NotVerifiedBadge />
              </div>
              <p className="text-sm text-pretty text-muted-foreground">
                Check deliverability with Hunter before you reach out. This may use Hunter credits;
                the result is saved.
              </p>
              <Button onClick={onVerify} disabled={verifying || disabled} size="sm" variant="outline">
                {verifying ? <Loader2 className="animate-spin" aria-hidden /> : <ShieldCheck />}
                {verifying ? "Verifying email..." : "Verify Email"}
              </Button>
            </div>
          )}
        </section>
      )}
    </>
  )
}
