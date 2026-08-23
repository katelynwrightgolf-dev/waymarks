"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Fingerprint, Loader2, MapPin } from "lucide-react"

import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"

type Mode = "sign-in" | "sign-up"

export function AuthForm({ mode, firstRun = false }: { mode: Mode; firstRun?: boolean }) {
  const router = useRouter()
  const isSignUp = mode === "sign-up"

  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [inviteCode, setInviteCode] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)

    try {
      if (isSignUp) {
        const code = inviteCode.trim().toUpperCase()
        // First run (no accounts yet) is the owner and needs no invite.
        if (!firstRun && !code) {
          setError("An invite code is required to join.")
          return
        }

        const res = await authClient.signUp.email({
          // Better Auth's core still models an email; this app is
          // username-only, so we derive a stable internal placeholder.
          email: `${username.trim().toLowerCase()}@waymarks.local`,
          password,
          name: username.trim(),
          username: username.trim(),
          // Validated and consumed server-side during user creation, so a
          // bad code fails the sign-up itself rather than after the fact.
          inviteCode: code,
        })
        if (res.error) {
          setError(friendlyError(res.error.message))
          return
        }
      } else {
        const res = await authClient.signIn.username({
          username: username.trim(),
          password,
        })
        if (res.error) {
          setError("That username or password isn't right.")
          return
        }
      }

      router.push("/")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.")
    } finally {
      setPending(false)
    }
  }

  async function handlePasskey() {
    setError(null)
    setPending(true)
    try {
      const res = await authClient.signIn.passkey()
      if (res?.error) {
        setError("Passkey sign-in didn't work. Use your password instead.")
        return
      }
      router.push("/")
      router.refresh()
    } catch {
      setError("Passkey sign-in isn't available on this device.")
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-5 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <MapPin className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-balance">Waymarks</h1>
        <p className="max-w-xs text-sm leading-relaxed text-muted-foreground text-pretty">
          {firstRun
            ? "Create the owner account to start tracking historical marks."
            : isSignUp
              ? "You'll need an invite code from whoever shared this with you."
              : "Sign in to your own private log of historical marks."}
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
        {isSignUp && !firstRun && (
          <div className="flex flex-col gap-2">
            <label htmlFor="invite" className="text-sm font-medium">
              Invite code
            </label>
            <input
              id="invite"
              name="invite"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="XXXX-XXXX-XXXX"
              required
              className="min-h-11 rounded-lg border border-border bg-card px-3 font-mono text-base tracking-widest text-card-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="username" className="text-sm font-medium">
            Username
          </label>
          <input
            id="username"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            minLength={3}
            required
            className="min-h-11 rounded-lg border border-border bg-card px-3 text-base text-card-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            minLength={8}
            required
            className="min-h-11 rounded-lg border border-border bg-card px-3 text-base text-card-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-primary"
          />
          {isSignUp && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending} className="min-h-11 w-full text-base">
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {isSignUp ? (firstRun ? "Create owner account" : "Join with invite") : "Sign in"}
        </Button>

        {!isSignUp && (
          <>
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs uppercase tracking-wider text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handlePasskey}
              disabled={pending}
              className="min-h-11 w-full bg-transparent text-base"
            >
              <Fingerprint className="mr-2 h-4 w-4" aria-hidden="true" />
              Sign in with passkey
            </Button>
          </>
        )}
      </form>

      <p className="text-sm text-muted-foreground">
        {isSignUp ? (
          <>
            Already have an account?{" "}
            <Link href="/sign-in" className="font-medium text-primary underline underline-offset-4">
              Sign in
            </Link>
          </>
        ) : (
          <>
            Have an invite code?{" "}
            <Link href="/sign-up" className="font-medium text-primary underline underline-offset-4">
              Join
            </Link>
          </>
        )}
      </p>
    </main>
  )
}

function friendlyError(message?: string) {
  if (!message) return "Couldn't create that account."
  const m = message.toLowerCase()
  if (m.includes("username") && (m.includes("taken") || m.includes("exist"))) {
    return "That username is already taken."
  }
  if (m.includes("password") && (m.includes("short") || m.includes("length") || m.includes("8"))) {
    return "Please choose a longer password."
  }
  // Fall back to the server's own wording rather than a guess, so real
  // configuration problems stay visible instead of being mislabeled.
  return message
}
