// ─── Comment Bubble Store ────────────────────────────────────────────────────
// Global state for the comment bubble. Any editor instance (context, requirement
// description, future task description) can open the bubble by writing to this
// store. The bubble component reads from it. No prop threading needed.

import { create } from 'zustand'
import type { Editor } from '@tiptap/core'

export type CommentBubbleState =
  | null
  | {
      mode: 'new'
      position: { top: number; left: number }
      selection: { from: number; to: number; text: string }
      fragmentName?: string
      sourceEditor?: Editor | null
    }
  | {
      mode: 'view'
      position: { top: number; left: number }
      commentIds: string[]
      fragmentName?: string
      sourceEditor?: Editor | null
    }

interface CommentBubbleStore {
  bubble: CommentBubbleState
  openBubble: (state: NonNullable<CommentBubbleState>) => void
  closeBubble: () => void
  reset: () => void
}

export const useCommentBubbleStore = create<CommentBubbleStore>((set) => ({
  bubble: null,
  openBubble: (state) => set({ bubble: state }),
  closeBubble: () => set({ bubble: null }),

  reset: () => set({ bubble: null })
}))
