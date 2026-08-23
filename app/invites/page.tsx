import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/lib/auth"
import { listInvites, viewerIsOwner } from "@/app/actions/invites"
import { InviteManager } from "@/components/invite-manager"

export default async function InvitesPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/sign-in")

  // Only the owner hands out invites. Invited people get their own log, not
  // the ability to invite further.
  if (!(await viewerIsOwner())) redirect("/")

  const invites = await listInvites()
  return <InviteManager initialInvites={invites} />
}
