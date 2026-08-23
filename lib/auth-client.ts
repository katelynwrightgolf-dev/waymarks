"use client"

import { createAuthClient } from "better-auth/react"
import { inferAdditionalFields, usernameClient } from "better-auth/client/plugins"
import { passkeyClient } from "@better-auth/passkey/client"

import type { auth } from "@/lib/auth"

export const authClient = createAuthClient({
  plugins: [
    // Teaches the client about the extra user fields declared on the server
    // (inviteCode), so sign-up can carry the code with full type safety.
    inferAdditionalFields<typeof auth>(),
    usernameClient(),
    passkeyClient(),
  ],
})

export const { signIn, signUp, signOut, useSession, passkey } = authClient
