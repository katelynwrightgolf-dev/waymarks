import { betterAuth } from "better-auth"
import { username } from "better-auth/plugins/username"
import { passkey } from "@better-auth/passkey"
import { nextCookies } from "better-auth/next-js"
import { Pool } from "pg"

const isDev = process.env.NODE_ENV === "development"

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

export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  baseURL,
  trustedOrigins: isDev ? devOrigins : prodOrigins,

  // The username plugin signs up and stores credentials through this provider,
  // so it must stay enabled. People sign in with a username; the email field
  // is an internal placeholder and is never shown or asked for.
  emailAndPassword: { enabled: true, requireEmailVerification: false },

  user: {
    additionalFields: {
      // Which invite code this account was created with, for the invite log.
      inviteCode: { type: "string", required: false, input: false },
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
