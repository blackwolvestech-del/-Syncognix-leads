"use client"

import { useState } from "react"
import { Check, ChevronDown, Lightbulb, MapPin, RefreshCw, ScanSearch } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { EmailLink } from "@/components/enrichment/decision-maker"
import { VerificationBadge } from "@/components/enrichment/enrichment-badges"
import { ScoreBadge } from "@/components/enrichment/prospect-score"
import { Missing, WebsiteLink, cityState } from "@/components/leads/business-cells"
import { platformLabel } from "@/lib/analysis/findings"
import { cn } from "@/lib/utils"
import type {
  BusinessAnalysis,
  ImportantPage,
  ScoreFactor,
  ServiceRecommendation,
  SocialPlatform,
  WebsiteAnalysis,
} from "@/types/analysis"
import type { LeadEnrichment, ProspectScore } from "@/types/enrichment"
import { AnalysisProgress } from "./analysis-cell"
import {
  AnalysisStatusBadge,
  QualifiedTierBadge,
  SCORE_HINTS,
  ScoreBar,
  scoreBarClass,
} from "./score-indicators"
import type { AnalysisActivity } from "./use-analysis"

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" })

const PRIORITY_STYLES: Record<ServiceRecommendation["priority"], string> = {
  high: "border-success/30 bg-success/10 text-success",
  medium: "border-warning/40 bg-warning/10 text-foreground",
  low: "border-border bg-muted text-muted-foreground",
}

const SOCIAL_PLATFORMS: SocialPlatform[] = ["facebook", "instagram", "linkedin", "youtube", "tiktok", "x"]

const PAGE_LABELS: Record<ImportantPage, string> = {
  services: "Services",
  about: "About",
  contact: "Contact",
  service_areas: "Service areas",
  pricing: "Pricing",
  testimonials: "Testimonials / reviews",
  faq: "FAQ",
  gallery: "Gallery / portfolio",
  team: "Team",
  booking: "Booking",
  blog: "Blog",
  locations: "Locations",
}

const AREA_LABELS = {
  conversion: "Conversion",
  local: "Local signals",
  seo: "SEO fundamentals",
  website: "Website",
  content: "Content and navigation",
} as const

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

/** "Yes" / "Missing" style value, or "Not measured" when it couldn't be checked. */
function Signal({ value, yes = "Yes", no = "Missing" }: { value: boolean | null; yes?: string; no?: string }) {
  if (value === null) return <span className="text-muted-foreground/70">Not measured</span>
  return <span className={value ? "text-success" : "text-muted-foreground"}>{value ? yes : no}</span>
}

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3.5 py-2.5 text-sm font-medium outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t px-3.5 py-2">{children}</div>
    </details>
  )
}

function SignalGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <dl className="mt-0.5 divide-y">{children}</dl>
    </div>
  )
}

function Factors({ title, factors }: { title: string; factors: ScoreFactor[] }) {
  if (factors.length === 0) return null
  return (
    <div className="py-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="mt-1 divide-y text-sm">
        {factors.map((factor) => (
          <li key={factor.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-1.5">
            <span>{factor.label}</span>
            <span className="text-right tabular-nums text-muted-foreground">
              {factor.measured ? `${factor.earned} / ${factor.max}` : "Not measured"}
            </span>
            {factor.note && <span className="col-span-2 text-xs text-muted-foreground">{factor.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function WebsiteSignals({ site, analysis }: { site: WebsiteAnalysis; analysis: BusinessAnalysis }) {
  const social = new Set(site.socialProfiles.map((profile) => profile.platform))
  return (
    <Collapsible title="Website signals">
      <SignalGroup title="Local SEO signals">
        <Row label="Google rating"><span className="text-muted-foreground/70">Not available</span></Row>
        <Row label="Review count"><span className="text-muted-foreground/70">Not available</span></Row>
        <Row label="City on website"><Signal value={site.cityMentioned} no="No" /></Row>
        <Row label="State on website"><Signal value={site.stateMentioned} no="No" /></Row>
        <Row label="Business phone"><Signal value={Boolean(analysis.business.phone)} no="Not on record" /></Row>
        <Row label="Phone on website">
          {site.phones.length === 0 ? (
            <Signal value={false} no="Not detected" />
          ) : (
            <Signal value={site.phoneMatchesListing} yes="Matches the listing" no="Different from the listing" />
          )}
        </Row>
        <Row label="Address on website"><Signal value={site.addressFound} no="Not detected" /></Row>
        <Row label="Local schema"><Signal value={site.hasLocalBusinessSchema} yes="Found" /></Row>
        <Row label="Service-area language"><Signal value={site.serviceAreaLanguage} yes="Detected" no="Not detected" /></Row>
        <Row label="Address consistency"><span className="text-muted-foreground/70">Not measured</span></Row>
      </SignalGroup>

      <SignalGroup title="Conversion signals">
        <Row label="Phone CTA"><Signal value={site.hasPhoneCta} /></Row>
        <Row label="Email link"><Signal value={site.hasEmailCta} /></Row>
        <Row label="Contact form">
          <Signal value={site.hasContactForm} yes={site.embeddedForm ? `Yes (embedded ${site.embeddedForm})` : "Yes"} />
        </Row>
        <Row label="Quote CTA"><Signal value={site.hasQuoteCta} /></Row>
        <Row label="Booking option"><Signal value={site.hasBookingCta} /></Row>
        <Row label="Primary CTA clarity">
          <span className="capitalize">{site.ctaClarity}</span>
        </Row>
      </SignalGroup>

      <SignalGroup title="Social profiles detected">
        {SOCIAL_PLATFORMS.map((platform) => (
          <Row key={platform} label={platformLabel(platform)}>
            <Signal value={social.has(platform)} no="No" />
          </Row>
        ))}
      </SignalGroup>

      <SignalGroup title="Important pages">
        {(Object.keys(PAGE_LABELS) as ImportantPage[]).map((page) => (
          <Row key={page} label={PAGE_LABELS[page]}>
            <Signal value={site.detectedPages.includes(page)} yes="Found" />
          </Row>
        ))}
      </SignalGroup>
      <p className="py-2 text-xs text-pretty text-muted-foreground">
        Read from the homepage HTML only. Other pages were not fetched, and nothing was submitted.
      </p>
    </Collapsible>
  )
}

function TechnicalDetails({ site }: { site: WebsiteAnalysis }) {
  const list = (items: string[]) => (items.length ? items.join(", ") : <Missing />)
  return (
    <Collapsible title="Technical details">
      <dl className="divide-y">
        <Row label="Requested URL">{site.requestedUrl}</Row>
        <Row label="Final URL">{site.finalUrl}</Row>
        <Row label="HTTP status">
          {site.statusCode}
          {site.redirectCount > 0 && ` · ${site.redirectCount} redirect${site.redirectCount === 1 ? "" : "s"}`}
        </Row>
        <Row label="HTTPS">
          <Signal value={site.https} yes={site.httpRedirectsToHttps ? "Yes (HTTP redirects to HTTPS)" : "Yes"} no="HTTP only" />
        </Row>
        <Row label="Response time">{(site.responseTimeMs / 1000).toFixed(1)}s to first response</Row>
        <Row label="Responsive setup">
          {site.hasViewport ? (
            <>Responsive configuration detected{site.responsiveHints.length > 0 && ` (${site.responsiveHints.join("; ")})`}</>
          ) : (
            "No viewport meta tag"
          )}
        </Row>
        <Row label="Title">{site.title ? `${site.title} (${site.title.length} characters)` : <Missing />}</Row>
        <Row label="Meta description">
          {site.metaDescription ? `${site.metaDescription} (${site.metaDescription.length} characters)` : <Missing />}
        </Row>
        <Row label="H1">{site.h1Count === 0 ? <Missing /> : `${site.h1Count}: ${site.h1Texts.join(" · ")}`}</Row>
        <Row label="H2 headings">{site.h2Count}</Row>
        <Row label="Canonical">{site.canonicalUrl ?? <Missing />}</Row>
        <Row label="Robots meta">{site.robotsMeta ?? "None"}</Row>
        <Row label="Language">{site.lang ?? <Missing />}</Row>
        <Row label="Schema">{site.schemaTypes.length ? site.schemaTypes.join(", ") : "Structured data not detected"}</Row>
        <Row label="Images">
          {site.imageCount} · {site.missingAltCount} without alt attribute · {site.emptyAltCount} with empty alt
        </Row>
        <Row label="Links">
          About {site.internalLinkCount} internal · {site.externalLinkCount} external
        </Row>
        <Row label="Homepage text">About {site.wordCount} words</Row>
        <Row label="Forms">
          {site.forms.length === 0
            ? "None in the HTML"
            : site.forms.map((form) => `${form.kind}${form.fields.length ? ` (${form.fields.join(", ")})` : ""}`).join(" · ")}
        </Row>
        <Row label="Calls to action">{list(site.ctas.map((cta) => `“${cta.text}”`))}</Row>
        <Row label="Phones on page">{list(site.phones.map((phone) => phone.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3")))}</Row>
        <Row label="Emails on page">{list(site.emails)}</Row>
        <Row label="Contact page">{site.contactPageUrl ?? <Missing />}</Row>
        <Row label="Service terms">{list(site.serviceTermsFound)}</Row>
      </dl>
    </Collapsible>
  )
}

/** The Business Intelligence Report. Controlled: pass a null analysis to close. */
export function AnalysisReportSheet({
  analysis: selected,
  enrichment,
  prospect,
  activity,
  disabled,
  onReanalyze,
  onOpenChange,
}: {
  analysis: BusinessAnalysis | null
  enrichment: LeadEnrichment | undefined
  prospect: ProspectScore | undefined
  /** Set while this business is being (re)analyzed. */
  activity: AnalysisActivity | undefined
  disabled?: boolean
  onReanalyze: () => void
  onOpenChange: (open: boolean) => void
}) {
  // Keep showing the last report while the panel animates closed.
  const [analysis, setAnalysis] = useState(selected)
  if (selected && selected !== analysis) setAnalysis(selected)

  const scores = analysis?.scores
  const site = analysis?.website ?? null
  const person = enrichment?.person
  const personName = person?.fullName ?? ([person?.firstName, person?.lastName].filter(Boolean).join(" ") || null)

  return (
    <Sheet open={selected !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        {analysis && scores && (
          <>
            <SheetHeader className="gap-3 border-b p-5 pr-12">
              <span className="grid size-10 place-items-center rounded-lg border bg-muted/50 text-muted-foreground">
                <ScanSearch className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="space-y-1">
                <SheetTitle className="text-lg leading-snug">{analysis.business.name}</SheetTitle>
                <SheetDescription className="flex items-center gap-1.5">
                  <MapPin className="size-3.5 shrink-0" aria-hidden />
                  {cityState(analysis.business.city, analysis.business.state) ?? "Location not available"}
                </SheetDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="font-normal">
                  {analysis.business.categoryLabel}
                </Badge>
                <AnalysisStatusBadge status={analysis.status} />
              </div>
            </SheetHeader>

            <div className="space-y-6 p-5">
              {/* Overview */}
              <section aria-labelledby="report-overview">
                <SectionTitle id="report-overview">Business intelligence report</SectionTitle>
                <div className="mt-3 rounded-lg border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">Qualified Lead Score</p>
                  <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
                    <p className="text-3xl leading-none font-semibold tracking-tight tabular-nums">
                      {scores.qualifiedLead ?? "—"}
                      <span className="text-sm font-normal text-muted-foreground"> / 100</span>
                    </p>
                    {scores.qualifiedLead !== null && <QualifiedTierBadge score={scores.qualifiedLead} />}
                  </div>
                  {scores.qualifiedLead !== null && (
                    <div
                      className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
                      role="meter"
                      aria-label="Qualified lead score"
                      aria-valuenow={scores.qualifiedLead}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className={cn("h-full rounded-full", scoreBarClass(scores.qualifiedLead))}
                        style={{ width: `${scores.qualifiedLead}%` }}
                      />
                    </div>
                  )}
                  {analysis.qualification.reasons.length > 0 && (
                    <ul className="mt-3 space-y-1 text-sm">
                      {analysis.qualification.reasons.map((reason) => (
                        <li key={reason} className="flex items-start gap-2">
                          <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
                          {reason}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-3 text-xs text-pretty text-muted-foreground">{SCORE_HINTS.qualifiedLead}</p>
                </div>
                {analysis.websiteNote && (
                  <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-pretty" role="note">
                    {analysis.websiteNote}
                  </p>
                )}
              </section>

              {/* Contact */}
              <section aria-labelledby="report-contact">
                <SectionTitle id="report-contact">Contact</SectionTitle>
                <dl className="mt-1 divide-y">
                  <Row label="Decision maker">
                    {personName ? (
                      <>
                        <span className="font-medium">{personName}</span>
                        {person?.title && <span className="block text-xs text-muted-foreground">{person.title}</span>}
                      </>
                    ) : (
                      <span className="text-muted-foreground/70">
                        {enrichment ? "No decision maker found" : "Not looked up yet"}
                      </span>
                    )}
                  </Row>
                  <Row label="Work email">
                    {enrichment?.email ? (
                      <div className="space-y-1">
                        <EmailLink address={enrichment.email.address} />
                        {enrichment.verification && (
                          <div>
                            <VerificationBadge verification={enrichment.verification} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <Missing />
                    )}
                  </Row>
                  <Row label="Website">
                    <WebsiteLink url={analysis.business.website} className="max-w-full" />
                  </Row>
                  {prospect && (
                    <Row label="Prospect Score">
                      <span className="inline-flex items-center gap-2">
                        <ScoreBadge prospect={prospect} />
                        <span className="text-xs text-muted-foreground">Before analysis</span>
                      </span>
                    </Row>
                  )}
                </dl>
              </section>

              {/* Scorecard */}
              <section aria-labelledby="report-scorecard">
                <SectionTitle id="report-scorecard">Scorecard</SectionTitle>
                <div className="mt-2">
                  <ScoreBar scoreKey="website" score={scores.website} />
                  <ScoreBar scoreKey="seo" score={scores.seo} />
                  <ScoreBar scoreKey="conversion" score={scores.conversion} />
                  <ScoreBar scoreKey="localPresence" score={scores.localPresence} />
                  <ScoreBar scoreKey="opportunity" score={scores.opportunity} />
                </div>
              </section>

              {/* Strengths */}
              {analysis.strengths.length > 0 && (
                <section aria-labelledby="report-strengths">
                  <SectionTitle id="report-strengths">Strengths</SectionTitle>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {analysis.strengths.map((strength) => (
                      <li key={strength.code} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                        {strength.text}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Opportunities */}
              <section aria-labelledby="report-opportunities">
                <SectionTitle id="report-opportunities">Opportunities</SectionTitle>
                {analysis.opportunities.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {analysis.status === "complete"
                      ? "No gaps were detected in the signals this analysis checks."
                      : "No opportunities could be identified without the website's content."}
                  </p>
                ) : (
                  (Object.keys(AREA_LABELS) as (keyof typeof AREA_LABELS)[]).map((area) => {
                    const items = analysis.opportunities.filter((opportunity) => opportunity.area === area)
                    if (items.length === 0) return null
                    return (
                      <div key={area} className="mt-3">
                        <p className="text-xs font-medium text-muted-foreground">{AREA_LABELS[area]}</p>
                        <ul className="mt-1 space-y-1.5 text-sm">
                          {items.map((opportunity) => (
                            <li key={opportunity.code} className="flex items-start gap-2">
                              <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                              <span className="text-pretty">{opportunity.text}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })
                )}
              </section>

              {/* Recommended services */}
              <section aria-labelledby="report-services">
                <SectionTitle id="report-services">Recommended services</SectionTitle>
                {analysis.recommendedServices.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No service is recommended: there isn&apos;t enough observed evidence to justify one.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2.5">
                    {analysis.recommendedServices.map((service) => (
                      <li key={service.service} className="rounded-lg border p-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium">{service.label}</p>
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase",
                              PRIORITY_STYLES[service.priority]
                            )}
                          >
                            {service.priority} priority
                          </span>
                        </div>
                        <p className="mt-2 text-xs font-medium text-muted-foreground">Why</p>
                        <p className="mt-0.5 text-sm text-pretty">{service.reason}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Details */}
              <section aria-label="Details" className="space-y-2.5">
                {site && !site.clientRendered && <WebsiteSignals site={site} analysis={analysis} />}
                {site && <TechnicalDetails site={site} />}
                <Collapsible title="Score breakdown">
                  <Factors title="Technical basics" factors={analysis.breakdown.technical} />
                  <Factors title="SEO fundamentals" factors={analysis.breakdown.seo} />
                  <Factors title="Conversion readiness" factors={analysis.breakdown.conversion} />
                  <Factors title="Local presence" factors={analysis.breakdown.localPresence} />
                  <Factors title="Content and navigation" factors={analysis.breakdown.content} />
                  <div className="py-2">
                    <p className="text-xs font-medium text-muted-foreground">Qualified Lead Score</p>
                    <ul className="mt-1 divide-y text-sm">
                      {analysis.qualification.components.map((component) => (
                        <li key={component.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-1.5">
                          <span>
                            {component.label}
                            <span className="text-xs text-muted-foreground"> · weight {component.weight}%</span>
                          </span>
                          <span className="text-right tabular-nums text-muted-foreground">
                            {component.value === null ? "Not measured" : `${component.value} / 100`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="py-2">
                    <p className="text-xs font-medium text-muted-foreground">Not measured in this version</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                      {analysis.notMeasured.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </Collapsible>
              </section>
            </div>

            <SheetFooter className="flex-col items-stretch gap-3 border-t p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-muted-foreground">
                {activity ? (
                  <AnalysisProgress activity={activity} name={analysis.business.name} />
                ) : (
                  <>
                    Last analyzed:{" "}
                    <span className="text-foreground">{dateFormat.format(new Date(analysis.analyzedAt))}</span>
                  </>
                )}
              </div>
              <Button variant="outline" onClick={onReanalyze} disabled={Boolean(activity) || disabled}>
                <RefreshCw className={cn(activity && "animate-spin")} aria-hidden /> Reanalyze
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
