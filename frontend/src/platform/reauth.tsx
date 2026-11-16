import {
  useCallback,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import FormField from '../components/FormField'
import { Button, ErrorNotice, Modal } from '../components/ui'
import { issuePlatformReauth } from './api'
import { ReauthContext } from './reauth-context'

interface ReauthRequest {
  purpose: string
  description: string
  resolve: (token: string | null) => void
}

export function PlatformReauthProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ReauthRequest | null>(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const ensureReauth = useCallback(
    (purpose: string, description?: string) =>
      new Promise<string | null>((resolve) => {
        setPassword('')
        setCode('')
        setError(null)
        setRequest({
          purpose,
          description:
            description ??
            'Confirm your password (and authenticator code when enabled) before this sensitive action.',
          resolve,
        })
      }),
    [],
  )

  const value = useMemo(() => ({ ensureReauth }), [ensureReauth])

  function close(token: string | null) {
    request?.resolve(token)
    setRequest(null)
    setPassword('')
    setCode('')
    setError(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!request || busy) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      const grant = await issuePlatformReauth({
        password,
        code: code.trim() || undefined,
        purpose: request.purpose,
      })
      close(grant.token)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not confirm your identity. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <ReauthContext.Provider value={value}>
      {children}
      <Modal
        open={request !== null}
        title="Confirm your identity"
        description={request?.description}
        onClose={() => {
          if (!busy) close(null)
        }}
      >
        <form onSubmit={submit} className="space-y-4">
          {error ? <ErrorNotice message={error} /> : null}
          <FormField
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <FormField
            label="Authenticator or recovery code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            hint="Required only when multi-factor authentication is enabled."
            autoComplete="one-time-code"
          />
          <p className="text-xs text-gradely-muted">
            The confirmation is valid for five minutes and can be used once.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => close(null)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Confirm
            </Button>
          </div>
        </form>
      </Modal>
    </ReauthContext.Provider>
  )
}
