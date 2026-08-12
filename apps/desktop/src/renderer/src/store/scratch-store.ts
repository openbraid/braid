import { create } from 'zustand'
import type { ScratchPage } from '../../../shared/ipc-types'
import { ipc } from '../lib/ipc'

export type ScratchContextForModal = {
  selectedText: string
  defaultAgent: string | null
} | null


type ScratchStore = {
  pages: ScratchPage[]           // all pages in DB
  openPageIds: string[]          // pages currently open as tabs
  activePageId: string | null
  panelOpen: boolean
  panelWidth: number
  searchQuery: string
  searchResults: ScratchPage[]
  searchOpen: boolean
  scratchContextForModal: ScratchContextForModal
  defaultAgent: string | null

  // Dictation
  dictationState: 'idle' | 'recording' | 'transcribing'
  dictationVolume: number[]
  dictationStatus: string | null

  // Undo delete
  _deletedPage: ScratchPage | null
  _undoTimer: ReturnType<typeof setTimeout> | null

  // Initialization
  loadPages: () => Promise<void>

  // Page CRUD
  createPage: (title?: string) => Promise<ScratchPage>
  updateContent: (id: string, content: string, textContent: string) => Promise<void>
  updateTitle: (id: string, title: string) => Promise<void>
  deletePage: (id: string) => Promise<void>
  undoDelete: () => Promise<void>

  // Default agent
  setDefaultAgent: (agentId: string | null) => void

  // Dictation
  setDictationState: (state: 'idle' | 'recording' | 'transcribing') => void
  setDictationVolume: (levels: number[]) => void
  setDictationStatus: (message: string | null) => void

  // Scratch context for workspace modal
  setScratchContextForModal: (ctx: ScratchContextForModal) => void


  // Tab management
  openPage: (id: string) => void
  closePage: (id: string) => void
  setActivePage: (id: string) => void

  // Panel
  togglePanel: () => void
  openPanel: () => void
  closePanel: () => void
  setPanelWidth: (width: number) => void

  // Search
  openSearch: () => void
  search: (query: string) => Promise<void>
  clearSearch: () => void

  // Cleanup
  reset: () => void
}

/** Kill active dictation if running — discards pending result. Called on page switch, panel close. */
function cancelDictationIfActive(): void {
  const state = useScratchStore.getState()
  if (state.dictationState !== 'idle') {
    ipc.scratch.dictationStop(true)
    useScratchStore.setState({ dictationState: 'idle', dictationVolume: [], dictationStatus: null })
  }
}

export const useScratchStore = create<ScratchStore>((set, get) => ({
  pages: [],
  openPageIds: [],
  activePageId: null,
  panelOpen: false,
  panelWidth: 520,
  searchQuery: '',
  searchResults: [],
  searchOpen: false,
  scratchContextForModal: null,
  defaultAgent: null,
  dictationState: 'idle' as const,
  dictationVolume: [],
  dictationStatus: null,
  _deletedPage: null,
  _undoTimer: null,

  loadPages: async () => {
    const pages = await ipc.scratch.getPages()
    const appState = await ipc.app.getState()

    // Restore open tabs from app-state, filtering out stale IDs
    const pageIds = new Set(pages.map((p) => p.id))
    let openPageIds = (appState.scratchOpenPageIds ?? []).filter((id: string) => pageIds.has(id))

    // If no open tabs, open all pages (first launch or all were closed)
    if (openPageIds.length === 0 && pages.length > 0) {
      openPageIds = pages.map((p) => p.id)
    }

    let activePageId = appState.scratchActivePageId
    if (!activePageId || !pageIds.has(activePageId)) {
      activePageId = openPageIds[0] ?? null
    }

    set({ pages, openPageIds, activePageId, defaultAgent: appState.defaultAgent ?? null })
  },

  createPage: async (title) => {
    const page = await ipc.scratch.createPage(title)
    const pages = await ipc.scratch.getPages()
    const openPageIds = [...get().openPageIds, page.id]
    set({ pages, openPageIds, activePageId: page.id })
    ipc.app.setState({ scratchActivePageId: page.id, scratchOpenPageIds: openPageIds })
    return page
  },

  updateContent: async (id, content, textContent) => {
    await ipc.scratch.updateContent(id, content, textContent)
    set((state) => ({
      pages: state.pages.map((p) =>
        p.id === id ? { ...p, content, textContent, updatedAt: Date.now() } : p
      )
    }))
  },

  updateTitle: async (id, title) => {
    await ipc.scratch.updateTitle(id, title)
    set((state) => ({
      pages: state.pages.map((p) =>
        p.id === id ? { ...p, title, updatedAt: Date.now() } : p
      )
    }))
  },

  deletePage: async (id) => {
    cancelDictationIfActive()
    const state = get()
    const page = state.pages.find((p) => p.id === id)
    if (!page) return

    // Clear any previous undo timer
    if (state._undoTimer) clearTimeout(state._undoTimer)

    await ipc.scratch.deletePage(id)
    const pages = await ipc.scratch.getPages()
    const openPageIds = state.openPageIds.filter((pid) => pid !== id)

    let activePageId = state.activePageId
    if (activePageId === id) {
      // Switch to the next open tab, or first open, or null
      const idx = state.openPageIds.indexOf(id)
      activePageId = openPageIds[Math.min(idx, openPageIds.length - 1)] ?? null
    }

    // Set undo timer — clear _deletedPage after 6 seconds
    const timer = setTimeout(() => {
      set({ _deletedPage: null, _undoTimer: null })
    }, 6000)

    set({ pages, openPageIds, activePageId, _deletedPage: page, _undoTimer: timer })
    ipc.app.setState({ scratchActivePageId: activePageId, scratchOpenPageIds: openPageIds })
  },

  undoDelete: async () => {
    const state = get()
    const page = state._deletedPage
    if (!page) return

    if (state._undoTimer) clearTimeout(state._undoTimer)

    // Re-create the page in DB
    const restored = await ipc.scratch.createPage(page.title)
    // Restore content if it had any
    if (page.content) {
      await ipc.scratch.updateContent(restored.id, page.content, page.textContent)
    }

    const pages = await ipc.scratch.getPages()
    const openPageIds = [...state.openPageIds, restored.id]

    set({
      pages,
      openPageIds,
      activePageId: restored.id,
      _deletedPage: null,
      _undoTimer: null
    })
    ipc.app.setState({ scratchActivePageId: restored.id, scratchOpenPageIds: openPageIds })
  },

  setDefaultAgent: (agentId) => {
    set({ defaultAgent: agentId })
    ipc.app.setState({ defaultAgent: agentId })
  },

  setDictationState: (state) => {
    set({ dictationState: state, ...(state === 'idle' ? { dictationVolume: [], dictationStatus: null } : {}) })
  },

  setDictationVolume: (levels) => {
    set({ dictationVolume: levels, dictationStatus: null })
  },

  setDictationStatus: (message) => {
    set({ dictationStatus: message })
  },

  setScratchContextForModal: (ctx) => {
    set({ scratchContextForModal: ctx })
  },

  openPage: (id) => {
    const state = get()
    if (state.openPageIds.includes(id)) {
      // Already open — just switch to it
      set({ activePageId: id })
      ipc.app.setState({ scratchActivePageId: id })
      return
    }
    const openPageIds = [...state.openPageIds, id]
    set({ openPageIds, activePageId: id })
    ipc.app.setState({ scratchActivePageId: id, scratchOpenPageIds: openPageIds })
  },

  closePage: (id) => {
    const state = get()
    if (state.activePageId === id) cancelDictationIfActive()
    const openPageIds = state.openPageIds.filter((pid) => pid !== id)

    let activePageId = state.activePageId
    if (activePageId === id) {
      const idx = state.openPageIds.indexOf(id)
      activePageId = openPageIds[Math.min(idx, openPageIds.length - 1)] ?? null
    }

    set({ openPageIds, activePageId })
    ipc.app.setState({ scratchActivePageId: activePageId, scratchOpenPageIds: openPageIds })
  },

  setActivePage: (id) => {
    const state = get()
    if (state.activePageId !== id) cancelDictationIfActive()
    set({ activePageId: id })
    ipc.app.setState({ scratchActivePageId: id })
  },

  togglePanel: () => {
    if (get().panelOpen) {
      get().closePanel()
    } else {
      get().openPanel()
    }
  },

  openPanel: () => {
    set({ panelOpen: true })
    ipc.app.setState({ scratchPanelOpen: true })
    import('../lib/analytics').then(({ track: t }) => t('scratch_opened'))
  },

  closePanel: () => {
    cancelDictationIfActive()
    set({ panelOpen: false })
    ipc.app.setState({ scratchPanelOpen: false })
  },

  setPanelWidth: (width) => {
    set({ panelWidth: width })
    ipc.app.setState({ scratchPanelWidth: width })
  },

  openSearch: () => {
    set({ searchOpen: true, searchQuery: '', searchResults: [] })
  },

  search: async (query) => {
    if (!query.trim()) {
      set({ searchQuery: '', searchResults: [] })
      return
    }
    set({ searchQuery: query })
    const results = await ipc.scratch.search(query)
    set({ searchResults: results })
  },

  clearSearch: () => {
    set({ searchQuery: '', searchResults: [], searchOpen: false })
  },

  reset: () =>
    set({
      pages: [],
      openPageIds: [],
      activePageId: null,
      panelOpen: false,
      panelWidth: 520,
      searchQuery: '',
      searchResults: [],
      searchOpen: false,
      scratchContextForModal: null,
      defaultAgent: null,
      dictationState: 'idle' as const,
      dictationVolume: [],
      dictationStatus: null,
      _deletedPage: null,
      _undoTimer: null
    })
}))
