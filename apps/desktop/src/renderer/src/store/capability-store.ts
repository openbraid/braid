import { create } from 'zustand'
import { Capability, type CapabilityMap, type CapabilityState } from '../../../shared/ipc-types'

// Optimistic default: everything enabled until main reports otherwise. The map
// arrives within the first tick, and defaulting to disabled would flash every
// server-backed control as greyed out on every launch.
const ENABLED: CapabilityState = { enabled: true, reason: null }

function allEnabled(): CapabilityMap {
  const map = {} as CapabilityMap
  for (const capability of Object.values(Capability)) map[capability] = ENABLED
  return map
}

type CapabilityStore = {
  capabilities: CapabilityMap
  setCapabilities: (capabilities: CapabilityMap) => void
  reset: () => void
}

export const useCapabilityStore = create<CapabilityStore>((set) => ({
  capabilities: allEnabled(),
  setCapabilities: (capabilities) => set({ capabilities }),
  reset: () => set({ capabilities: allEnabled() })
}))

/**
 * Ask whether a feature is available. Returns the reason alongside, so callers
 * can put it straight into a tooltip rather than inventing their own copy.
 */
export function useCapability(capability: Capability): CapabilityState {
  return useCapabilityStore((s) => s.capabilities[capability])
}
