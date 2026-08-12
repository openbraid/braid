import { Toaster as SonnerToaster } from 'sonner'

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      theme="dark"
      closeButton
      toastOptions={{
        style: {
          background: 'var(--bg-surface-elevated)',
          border: '1px solid var(--border-strong)',
          color: 'var(--text-primary)',
          fontSize: '12px'
        },
        descriptionClassName: '!text-[var(--text-primary)]'
      }}
    />
  )
}
