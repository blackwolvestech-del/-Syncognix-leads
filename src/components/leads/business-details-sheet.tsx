"use client"

import { useState } from "react"
import { Building2, MapPin } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Missing, PhoneLink, WebsiteLink, cityState } from "./business-cells"

/** Everything the details panel shows; built from a search result or a saved lead. */
export interface BusinessDetails {
  name: string
  categoryLabel: string
  website: string | null
  phone: string | null
  address: string | null
  street: string | null
  city: string | null
  state: string | null
  postcode: string | null
  latitude: number | null
  longitude: number | null
  osmId: string
  osmType: string
  source: string
  /** Set for saved leads. */
  addedAt?: string
}

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

function osmUrl(osmId: string) {
  const [type, id] = osmId.split(":")
  return type && id && /^\d+$/.test(id) ? `https://www.openstreetmap.org/${type}/${id}` : null
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function Value({ value }: { value: string | null }) {
  return value ? <>{value}</> : <Missing />
}

/** Side panel with a business's full details. Controlled: pass null to close. */
export function BusinessDetailsSheet({
  business: selected,
  onOpenChange,
  footer,
  children,
}: {
  business: BusinessDetails | null
  onOpenChange: (open: boolean) => void
  footer?: React.ReactNode
  /** Extra sections (prospect analysis, decision maker…) shown before Source. */
  children?: React.ReactNode
}) {
  // Keep showing the last business while the panel animates closed.
  const [business, setBusiness] = useState(selected)
  if (selected && selected !== business) setBusiness(selected)

  const hasCoordinates = business?.latitude != null && business.longitude != null
  const mapLink = business ? osmUrl(business.osmId) : null

  return (
    <Sheet open={selected !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {business && (
          <>
            <SheetHeader className="gap-3 border-b p-5 pr-12">
              <span className="grid size-10 place-items-center rounded-lg border bg-muted/50 text-muted-foreground">
                <Building2 className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="space-y-1">
                <SheetTitle className="text-lg leading-snug">{business.name}</SheetTitle>
                <SheetDescription className="flex items-center gap-1.5">
                  <MapPin className="size-3.5 shrink-0" aria-hidden />
                  {cityState(business.city, business.state) ?? "Location not available"}
                </SheetDescription>
              </div>
              <Badge variant="secondary" className="font-normal">
                {business.categoryLabel}
              </Badge>
            </SheetHeader>

            <div className="space-y-6 p-5">
              <section aria-labelledby="details-contact">
                <h3 id="details-contact" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Contact
                </h3>
                <dl className="mt-1 divide-y">
                  <Row label="Website">
                    <WebsiteLink url={business.website} className="max-w-full" />
                  </Row>
                  <Row label="Phone">
                    <PhoneLink phone={business.phone} />
                  </Row>
                </dl>
              </section>

              <section aria-labelledby="details-location">
                <h3 id="details-location" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Location
                </h3>
                <dl className="mt-1 divide-y">
                  <Row label="Address"><Value value={business.address ?? business.street} /></Row>
                  <Row label="City"><Value value={business.city} /></Row>
                  <Row label="State"><Value value={business.state} /></Row>
                  <Row label="ZIP"><Value value={business.postcode} /></Row>
                  <Row label="Coordinates">
                    {hasCoordinates ? (
                      <span className="tabular-nums">
                        {business.latitude!.toFixed(5)}, {business.longitude!.toFixed(5)}
                      </span>
                    ) : (
                      <Missing />
                    )}
                  </Row>
                </dl>
              </section>

              {children}

              <section aria-labelledby="details-source">
                <h3 id="details-source" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Source
                </h3>
                <dl className="mt-1 divide-y">
                  <Row label="Source">{business.source}</Row>
                  <Row label="OSM ID">
                    {mapLink ? (
                      <a
                        href={mapLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-sm font-mono text-[13px] text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        {business.osmId}
                        <span className="sr-only"> (opens OpenStreetMap in a new tab)</span>
                      </a>
                    ) : (
                      <span className="font-mono text-[13px]">{business.osmId}</span>
                    )}
                  </Row>
                  {business.addedAt && (
                    <Row label="Date added">
                      {dateFormat.format(new Date(business.addedAt))}
                    </Row>
                  )}
                </dl>
              </section>
            </div>

            {footer && <SheetFooter className="border-t p-5">{footer}</SheetFooter>}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
