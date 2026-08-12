// ─── useAutoSave ─────────────────────────────────────────────────────────────
// Monitors HocuspocusProvider sync status for save indicator.
// Only shows "Saved" after the user makes changes — not on initial sync.

import { useEffect, useState, useRef } from 'react'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import { SAVED_INDICATOR_DURATION_MS } from '../components/artifact-editor/editor-constants'

type AutoSaveStatus = 'idle' | 'saved'

export interface UseAutoSaveResult {
  status: AutoSaveStatus
  lastSavedAt: number | null
}

export function useAutoSave(provider: HocuspocusProvider | null): UseAutoSaveResult {
  const [status, setStatus] = useState<AutoSaveStatus>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasPendingChangesRef = useRef(false)

  useEffect(() => {
    if (!provider) {
      setStatus('idle')
      hasPendingChangesRef.current = false
      return
    }

    const handleUnsyncedChanges = () => {
      // User made local changes that haven't been confirmed by server yet
      hasPendingChangesRef.current = true
    }

    const handleSynced = ({ state }: { state: boolean }) => {
      if (state && hasPendingChangesRef.current) {
        // Only show "Saved" if there were actual pending changes
        hasPendingChangesRef.current = false
        setStatus('saved')
        setLastSavedAt(Date.now())

        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
        fadeTimerRef.current = setTimeout(() => {
          setStatus('idle')
        }, SAVED_INDICATOR_DURATION_MS)
      }
    }

    provider.on('unsyncedChanges', handleUnsyncedChanges)
    provider.on('synced', handleSynced)

    return () => {
      provider.off('unsyncedChanges', handleUnsyncedChanges)
      provider.off('synced', handleSynced)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    }
  }, [provider])

  return { status, lastSavedAt }
}
