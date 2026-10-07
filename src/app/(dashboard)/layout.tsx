import { AppHeader } from "@/components/layout/app-header"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { TimeZoneCookie } from "@/components/pipeline/time-zone-cookie"
import { requireUser } from "@/lib/auth/user"

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  // The proxy already redirects signed-out visitors; this re-verifies on the
  // server before any workspace UI renders.
  const user = await requireUser()

  return (
    <div className="min-h-dvh">
      <TimeZoneCookie />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-md focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <AppSidebar user={user} />
      <div className="flex min-h-dvh flex-col lg:pl-60">
        <AppHeader user={user} />
        <main id="main" className="flex-1">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
