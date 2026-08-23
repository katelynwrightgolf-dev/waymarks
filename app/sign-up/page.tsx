import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { AuthForm } from "@/components/auth-form"
import { auth } from "@/lib/auth"
import { isFirstRun } from "@/app/actions/invites"

export default async function SignUpPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (session?.user) redirect("/")

  // No accounts yet means this is you setting up -- no invite code needed,
  // and this account adopts the check-ins already in the database.
  const firstRun = await isFirstRun()
  return <AuthForm mode="sign-up" firstRun={firstRun} />
}
