import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { MapPinned } from "lucide-react"

import { getVisits } from "@/app/actions/visits"
import { viewerIsOwner } from "@/app/actions/invites"
import { LandmarkTracker } from "@/components/landmark-tracker"
import { AccountMenu } from "@/components/account-menu"
import { auth } from "@/lib/auth"

export default async function HomePage() {
  // Server-side session check: this is the authorization boundary, and the
  // visit query below is scoped to this user.
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/sign-in")

  const [initialVisits, ownerViewing] = await Promise.all([getVisits(), viewerIsOwner()])
  const displayName = (session.user as { username?: string; name?: string }).username ?? session.user.name

  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-4 pb-16 pt-6">
      <header className="mb-6 flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <MapPinned className="size-6" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-2xl font-semibold leading-tight text-foreground">Waymarks</h1>
          <p className="truncate text-sm text-muted-foreground">{displayName}&apos;s historic stops</p>
        </div>
        <AccountMenu username={displayName ?? "you"} isOwner={ownerViewing} />
      </header>

      <LandmarkTracker initialVisits={initialVisits} />

      <footer className="mt-10 text-center text-xs text-muted-foreground">
        Historic places from the National Park Service&apos;s National Register and the Texas Historical Commission
      </footer>
    </main>
  )
}
