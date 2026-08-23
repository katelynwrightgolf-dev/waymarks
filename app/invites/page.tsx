import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/lib/auth"
import { listInvites } from "@/app/actions/invites"
import { InviteManager } from "@/components/invite-manager"

export default async function InvitesPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/sign-in")

  const invites = await listInvites()
  return <InviteManager initialInvites={invites} />
}
