import { useState } from "react"
import { ShieldCheckIcon, UserIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ApiError, api } from "@/lib/api"
import { useSession } from "@/lib/session"

const DEMO = [
  { username: "agent@demo.local", password: "agent123", label: "Engineer", icon: UserIcon, note: "Ask questions, approve your own SQL" },
  { username: "admin@demo.local", password: "admin123", label: "Admin", icon: ShieldCheckIcon, note: "Also upload documents and see caches" },
]

export function LoginView() {
  const { signIn } = useSession()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (u = username, p = password) => {
    setBusy(true)
    setError(null)
    try {
      signIn(await api.login(u, p))
    } catch (e) {
      setError(e instanceof ApiError ? (e.status === 401 ? "Wrong username or password." : e.message) : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-5xl items-center gap-10 px-4 py-10 md:grid-cols-[1.1fr_1fr]">
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          Ask your Kubernetes clusters questions in plain English
        </h1>
        <p className="max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">
          A working demo of an AI assistant for operations engineers. It reads documentation, queries the incident
          database with your approval, and shows every safety check it ran on the way.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Sign in</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid gap-2 sm:grid-cols-2">
            {DEMO.map((d) => (
              <button
                key={d.username}
                type="button"
                disabled={busy}
                onClick={() => void submit(d.username, d.password)}
                className="flex flex-col gap-1 rounded-md border p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <d.icon className="size-4 text-primary" weight="duotone" aria-hidden />
                  Demo {d.label.toLowerCase()}
                </span>
                <span className="text-xs text-muted-foreground">{d.note}</span>
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <FieldGroup>
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor="username">Username</FieldLabel>
                <Input
                  id="username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  aria-invalid={Boolean(error)}
                />
              </Field>
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={Boolean(error)}
                />
                {error && <FieldError>{error}</FieldError>}
              </Field>
              <Button type="submit" disabled={busy || !username || !password}>
                Sign in
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
