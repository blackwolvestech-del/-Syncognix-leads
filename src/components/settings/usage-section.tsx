import { ShieldCheck, UserRoundSearch, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { brand } from "@/config/brand"
import type { ProviderUsage } from "@/types/enrichment"

const PROVIDERS: Record<
  ProviderUsage["provider"],
  { name: string; purpose: string; unit: string; envVar: string; icon: LucideIcon }
> = {
  prospeo: {
    name: "Prospeo",
    purpose: "Decision makers and work emails",
    unit: "Requests this month",
    envVar: "PROSPEO_API_KEY",
    icon: UserRoundSearch,
  },
  hunter: {
    name: "Hunter",
    purpose: "Email verification",
    unit: "Verifications this month",
    envVar: "HUNTER_API_KEY",
    icon: ShieldCheck,
  },
}

const numberFormat = new Intl.NumberFormat("en-US")

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg leading-none font-semibold tracking-tight tabular-nums">{value}</dd>
    </div>
  )
}

/** Settings → Usage: this month's provider calls, counted by the app itself. */
export function UsageSection({ usage }: { usage: ProviderUsage[] }) {
  return (
    <div>
      <ul className="divide-y">
        {usage.map((item) => {
          const { name, purpose, unit, envVar, icon: Icon } = PROVIDERS[item.provider]
          return (
            <li key={item.provider} className="flex items-start gap-4 p-5">
              <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted/50 text-muted-foreground">
                <Icon className="size-4" strokeWidth={1.85} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{name}</p>
                  {item.configured ? (
                    <Badge variant="outline" className="border-success/30 bg-success/10 font-normal text-success">
                      Connected
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="font-normal">
                      Not configured
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{purpose}</p>

                {item.configured ? (
                  <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
                    <Stat label={unit} value={numberFormat.format(item.requestsThisMonth)} />
                    {item.provider === "prospeo" && (
                      <Stat
                        label="Estimated credits used"
                        value={numberFormat.format(item.creditsEstimatedThisMonth)}
                      />
                    )}
                    {item.account?.remaining != null && (
                      <Stat
                        label={`Credits left (reported by ${name})`}
                        value={numberFormat.format(item.account.remaining)}
                      />
                    )}
                  </dl>
                ) : (
                  <p className="mt-3 text-[13px] text-pretty text-muted-foreground">
                    Add <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{envVar}</code> to
                    your environment settings (<code className="font-mono text-xs">.env.local</code>, or
                    your host&apos;s environment variables) and restart the app.
                    {item.requestsThisMonth > 0 &&
                      ` ${numberFormat.format(item.requestsThisMonth)} requests were made earlier this month.`}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="border-t bg-muted/30 px-5 py-3 text-xs text-pretty text-muted-foreground">
        Request counts are {brand.name}&apos;s own counter of actions you started here. They are not
        your official provider balance; a balance is only shown when the provider reports it. Nothing
        is ever looked up or verified automatically.
      </p>
    </div>
  )
}
