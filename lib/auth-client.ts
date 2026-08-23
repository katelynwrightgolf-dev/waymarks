"use client"

import { createAuthClient } from "better-auth/react"
import { usernameClient } from "better-auth/client/plugins"
import { passkeyClient } from "@better-auth/passkey/client"

export const authClient = createAuthClient({
  plugins: [usernameClient(), passkeyClient()],
})

export const { signIn, signUp, signOut, useSession, passkey } = authClient
