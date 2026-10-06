import type { Metadata } from "next"
import { Bot, Send, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { FadeIn } from "@/components/shared/motion"
import { PageHeader } from "@/components/shared/page-header"
import { brand } from "@/config/brand"
import { AppearanceSettings } from "@/components/settings/appearance-settings"
import { ProfileForm } from "@/components/settings/profile-form"
import { SettingsSection } from "@/components/settings/settings-section"
import { SignOutButton } from "@/components/settings/sign-out-button"
import { UsageSection } from "@/components/settings/usage-section"
import { requireUser } from "@/lib/auth/user"
import { getMonthlyUsage } from "@/lib/enrichment/usage"

export const metadata: Metadata = { title: "Settings" }

const integrations: { title: string; description: string; icon: LucideIcon }[] = [
  {
    title: "AI Provider",
    description: "Connect a model to analyze businesses and draft personalized outreach.",
    icon: Bot,
  },
  {
    title: "Email Sending",
    description: "Send and track campaigns from your own mailbox or sending provider.",
    icon: Send,
  },
]

export default async function SettingsPage() {
  const user = await requireUser()
  const usage = await getMonthlyUsage(user.id)

  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description="Manage your profile, preferences and workspace." />

      <FadeIn className="space-y-8">
        <SettingsSection
          id="profile"
          title="Profile"
          description={`How you appear across your ${brand.name} workspace.`}
        >
          <ProfileForm user={user} />
        </SettingsSection>

        <SettingsSection
          id="appearance"
          title="Appearance"
          description="Choose a theme, or follow your system setting."
        >
          <AppearanceSettings />
        </SettingsSection>

        <SettingsSection id="account" title="Account" description="Session and sign-in details.">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">Signed in as</p>
              <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            </div>
            <SignOutButton />
          </div>
        </SettingsSection>

        <SettingsSection
          id="usage"
          title="Usage"
          description="Decision-maker lookups and email verifications you've run this month."
        >
          <UsageSection usage={usage} />
        </SettingsSection>

        <SettingsSection
          id="integrations"
          title="Integrations"
          description="More services for analysis and outreach."
        >
          <ul className="divide-y">
            {integrations.map(({ title, description, icon: Icon }) => (
              <li key={title} className="flex items-start gap-4 p-5">
                <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted/50 text-muted-foreground">
                  <Icon className="size-4" strokeWidth={1.85} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{title}</p>
                    <Badge variant="secondary" className="font-normal">
                      Coming soon
                    </Badge>
                  </div>
                  <p className="mt-1 text-[13px] text-pretty text-muted-foreground">{description}</p>
                </div>
              </li>
            ))}
          </ul>
        </SettingsSection>
      </FadeIn>
    </div>
  )
}
