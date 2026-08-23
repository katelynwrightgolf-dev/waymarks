import { betterAuth } from "better-auth"
import { APIError } from "better-auth/api"
import { username } from "better-auth/plugins/username"
import { passkey } from "@better-auth/passkey"
import { nextCookies } from "better-auth/next-js"
import { Pool } from "pg"

import {
  adoptOrphanVisits,
  attachInviteToUser,
  noAccountsYet,
  normalizeCode,
  reserveInviteCode,
} from "@/lib/invite-guard"

const isDev = process.env.NODE_ENV === "development"

/** Recorded on the owner account, which is created without an invite code. */
const OWNER_MARKER = "OWNER"

/**
 * Env values arrive single-quoted, which would make the origin string fail an
 * exact comparison. Reduce each to a bare scheme://host origin.
 */
function toOrigin(raw?: string) {
  if (!raw) return undefined
  const cleaned = raw.trim().replace(/^['"]|['"]$/g, "")
  try {
    return new URL(cleaned).origin
  } catch {
    return undefined
  }
}

/**
 * Exact v0-provided preview origins. The v0 preview is reachable through
 * several hostnames, and Better Auth rejects any origin not listed here.
 * Only exact values are trusted -- never wildcards or a reflected origin.
 * V0_CALLBACK_URL is deliberately excluded: it is an external callback
 * service, not an origin this app is served from.
 */
const devOrigins = [
  "http://localhost:3000",
  toOrigin(process.env.V0_RUNTIME_URL),
  toOrigin(process.env.V0_BUILD_URL),
  toOrigin(process.env.V0_SANDBOX_URL),
].filter(Boolean) as string[]

const prodOrigins = [
  process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
  process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
].filter(Boolean) as string[]

const baseURL =
  toOrigin(process.env.BETTER_AUTH_URL) ||
  toOrigin(
    process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
  ) ||
  toOrigin(process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) ||
  toOrigin(process.env.V0_RUNTIME_URL)

/**
 * Session cookies are signed with this. If it were missing in production,
 * Better Auth would fall back to an internal default, which would make
 * sessions forgeable -- so refuse to start instead of running insecurely.
 */
const secret = process.env.BETTER_AUTH_SECRET
if (!secret && !isDev) {
  throw new Error(
    "BETTER_AUTH_SECRET is not set. Add it in v0 under Settings -> Vars (or in your " +
      "Vercel project's Environment Variables) using any random 32+ character string, " +
      "then redeploy. Sign-in cannot be secured without it.",
  )
}

export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  baseURL,
  secret,
  trustedOrigins: isDev ? devOrigins : prodOrigins,

  // The username plugin signs up and stores credentials through this provider,
  // so it must stay enabled. People sign in with a username; the email field
  // is an internal placeholder and is never shown or asked for.
  emailAndPassword: { enabled: true, requireEmailVerification: false },

  user: {
    additionalFields: {
      // Which invite code this account was created with, for the invite log.
      // input: true so the sign-up request can carry it to the hook below,
      // where it is validated before any row is written.
      inviteCode: { type: "string", required: false, input: true },
    },
  },

  databaseHooks: {
    user: {
      create: {
        /**
         * The real invite gate. This runs on every path that creates a user,
         * including a direct POST to /api/auth/sign-up/email, so an invite
         * cannot be skipped by calling the API instead of using the form.
         */
        before: async (newUser: Record<string, unknown>) => {
          if (await noAccountsYet()) {
            // First account is the owner and needs no invite.
            return { data: { ...newUser, inviteCode: OWNER_MARKER } }
          }

          const code = normalizeCode(newUser.inviteCode)
          if (!code) {
            throw new APIError("BAD_REQUEST", { message: "An invite code is required to join." })
          }
          if (!(await reserveInviteCode(code))) {
            throw new APIError("BAD_REQUEST", {
              message: "That invite code is not valid, or it has already been used.",
            })
          }

          return { data: { ...newUser, inviteCode: code } }
        },
        after: async (createdUser: { id: string; inviteCode?: string | null }) => {
          const code = normalizeCode(createdUser.inviteCode)
          if (code === OWNER_MARKER) {
            // The owner adopts the check-ins logged before accounts existed.
            await adoptOrphanVisits(createdUser.id)
            return
          }
          if (code) await attachInviteToUser(code, createdUser.id)
        },
      },
    },
  },

  plugins: [
    username({ minUsernameLength: 3, maxUsernameLength: 32 }),
    // Passkeys (Face ID / fingerprint). rpID must be the bare hostname.
    passkey({
      rpName: "Waymarks",
      ...(baseURL ? { rpID: new URL(baseURL).hostname } : {}),
    }),
    // Must be last: lets server actions forward Set-Cookie to Next.js.
    nextCookies(),
  ],

  ...(isDev
    ? {
        advanced: {
          // Required by the cross-site v0 preview iframe. Without these
          // attributes, login succeeds but the next request appears signed out.
          defaultCookieAttributes: {
            sameSite: "none" as const,
            secure: true,
          },
        },
      }
    : {}),
})
