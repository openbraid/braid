import { useState, useEffect, useRef } from 'react'
import { Loader2, Mail } from 'lucide-react'
import { BraidMark } from '../ui/BraidMark'
import { ipc } from '../../lib/ipc'
import { useAuthStore } from '../../store/auth-store'
import type { AuthProvider } from '../../../../shared/ipc-types'

const SIGN_IN_TIMEOUT_MS = 3 * 60 * 1000 // 3 minutes

function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

function GitHubIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

const providers = [
  { id: 'GoogleOAuth' as AuthProvider, label: 'Continue with Google', Icon: GoogleIcon },
  { id: 'GitHubOAuth' as AuthProvider, label: 'Continue with GitHub', Icon: GitHubIcon },
  { id: 'authkit' as AuthProvider, label: 'Continue with Email', Icon: null }
]

export function LoginPage() {
  const [signingIn, setSigningIn] = useState<AuthProvider | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const storeError = useAuthStore((s) => s.error)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const error = storeError || localError

  // Clear timeout on unmount or when auth succeeds
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  // Reset spinner when store error arrives (e.g., backend provisioning failed)
  useEffect(() => {
    if (storeError) {
      setSigningIn(null)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [storeError])

  async function handleSignIn(provider: AuthProvider) {
    setSigningIn(provider)
    setLocalError(null)
    useAuthStore.getState().setError(null)

    const result = await ipc.auth.signIn(provider)
    if (!result.success) {
      setSigningIn(null)
      setLocalError('Unable to open sign-in. Please try again.')
      return
    }

    // Start 3-minute timeout
    timeoutRef.current = setTimeout(() => {
      setSigningIn(null)
      setLocalError('Sign-in timed out. Please try again.')
    }, SIGN_IN_TIMEOUT_MS)
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-page">
      {/* Draggable title bar area */}
      <div
        className="h-[38px] w-full shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* Centered login content */}
      <div className="flex-1 flex flex-col items-center justify-center -mt-[38px]">
        <BraidMark size={40} />
        <h1 className="text-[22px] font-medium text-fg mt-4">Braid</h1>
        <p className="text-[14px] text-fg-secondary mt-1">
          Your AI development workspace
        </p>

        {error && (
          <div className="mt-6 w-[280px] px-3 py-2 rounded-lg bg-surface-elevated border border-error/30 text-[13px] text-error text-center">
            {error}
          </div>
        )}

        <div className={['flex flex-col gap-3 w-[280px]', error ? 'mt-4' : 'mt-8'].join(' ')}>
          {providers.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => handleSignIn(id)}
              disabled={signingIn !== null}
              className={[
                'flex items-center justify-center gap-2.5 h-10 rounded-lg text-[13px] font-medium transition-colors',
                'bg-surface-elevated border border-border text-fg hover:bg-surface-hover',
                signingIn === id ? 'opacity-70 cursor-wait' : '',
                signingIn !== null && signingIn !== id ? 'opacity-40 cursor-not-allowed' : ''
              ].join(' ')}
            >
              {signingIn === id ? (
                <Loader2 size={16} className="animate-spin" />
              ) : Icon ? (
                <Icon size={18} />
              ) : (
                <Mail size={18} strokeWidth={1.5} />
              )}
              {label}
            </button>
          ))}
        </div>

        {signingIn && !error && (
          <p className="text-[12px] text-fg-tertiary mt-4">
            Completing sign-in in your browser...
          </p>
        )}
      </div>
    </div>
  )
}
