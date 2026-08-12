// ─── useYjsEditor ────────────────────────────────────────────────────────────
// Creates a Yjs-backed Tiptap editor for Shared mode.
// Manages Y.Doc, HocuspocusProvider, and editor lifecycle.
// Includes comment decoration extension for rendering yellow underlines.
// Cleans up everything on disable or unmount.

import { useEffect, useRef, useState } from 'react'
import { Editor, Extension } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { getBaseExtensions } from '../components/artifact-editor/editor-extensions'
import { createCommentDecorationsPlugin } from '../components/artifact-editor/extensions/comment-decorations'
import { ipc } from '../lib/ipc'

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

interface UseYjsEditorOptions {
  workspaceId: string
  kind: string
  enabled: boolean
  userName?: string
  userColor?: string
}

interface UseYjsEditorResult {
  editor: Editor | null
  ydoc: Y.Doc | null
  provider: HocuspocusProvider | null
  connectionStatus: ConnectionStatus
}

export function useYjsEditor({
  workspaceId,
  kind,
  enabled,
  userName = 'Anonymous',
}: UseYjsEditorOptions): UseYjsEditorResult {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [editor, setEditor] = useState<Editor | null>(null)

  const ydocRef = useRef<Y.Doc | null>(null)
  const providerRef = useRef<HocuspocusProvider | null>(null)
  const editorRef = useRef<Editor | null>(null)

  useEffect(() => {
    if (!enabled) {
      // Cleanup when disabled (switch to Local mode)
      cleanup()
      setEditor(null)
      setConnectionStatus('disconnected')
      return
    }

    let cancelled = false

    async function setup() {
      // Get WebSocket URL and token from main process
      const { url } = await ipc.artifacts.getCollabUrl(workspaceId, kind)
      if (cancelled) return

      // Create Y.Doc
      const ydoc = new Y.Doc()
      ydocRef.current = ydoc

      // Create HocuspocusProvider
      const provider = new HocuspocusProvider({
        url,
        name: `artifact:${workspaceId}:${kind}`,
        document: ydoc,
        token: async () => {
          // Fresh token on every reconnection
          const result = await ipc.artifacts.getCollabUrl(workspaceId, kind)
          return result.token
        },
        onStatus: ({ status }: { status: string }) => {
          if (cancelled) return
          if (status === 'connected') setConnectionStatus('connected')
          else if (status === 'connecting') setConnectionStatus('connecting')
          else setConnectionStatus('disconnected')
        },
      })
      providerRef.current = provider

      // Wait for initial sync before creating editor
      await new Promise<void>((resolve) => {
        if (provider.isSynced) {
          resolve()
          return
        }
        provider.on('synced', () => resolve())
      })

      if (cancelled) {
        provider.destroy()
        ydoc.destroy()
        return
      }

      // Create Tiptap editor bound to Y.XmlFragment('context')
      const newEditor = new Editor({
        extensions: [
          ...getBaseExtensions(),
          Collaboration.configure({
            document: ydoc,
            field: 'context',
          }),
          Extension.create({
            name: 'commentDecorations',
            addProseMirrorPlugins: () => [
              createCommentDecorationsPlugin({ ydoc, editorRef }),
            ],
          }),
        ],
        editorProps: {
          attributes: {
            class: 'artifact-editor-content outline-none',
          },
        },
      })

      if (cancelled) {
        newEditor.destroy()
        provider.destroy()
        ydoc.destroy()
        return
      }

      // Server now creates proper ProseMirror nodes directly in Y.XmlFragment
      // via server-side markdown parsing (markdown-it + @tiptap/html).
      // No _pendingContext bootstrap needed — Collaboration extension picks up
      // whatever nodes are in the fragment automatically.

      editorRef.current = newEditor
      setEditor(newEditor)
      setConnectionStatus('connecting')
    }

    setup()

    return () => {
      cancelled = true
      cleanup()
      setEditor(null)
      setConnectionStatus('disconnected')
    }
  }, [enabled, workspaceId, kind, userName])

  function cleanup() {
    if (editorRef.current) {
      editorRef.current.destroy()
      editorRef.current = null
    }
    if (providerRef.current) {
      providerRef.current.destroy()
      providerRef.current = null
    }
    if (ydocRef.current) {
      ydocRef.current.destroy()
      ydocRef.current = null
    }
  }

  return {
    editor,
    ydoc: ydocRef.current,
    provider: providerRef.current,
    connectionStatus,
  }
}
