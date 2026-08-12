import { useState, useCallback, useRef, useMemo } from 'react'
import type { Editor } from '@tiptap/core'
import { useYjsEditor } from '../../hooks/useYjsEditor'
import { useYjsArtifact } from '../../hooks/useYjsArtifact'
import { useAutoSave } from '../../hooks/useAutoSave'
import { useComments } from '../../hooks/useComments'
import { useAuthStore } from '../../store/auth-store'
import { useCommentBubbleStore } from '../../store/comment-bubble-store'
import { EditorToolbar } from '../artifact-editor/EditorToolbar'
import { SearchBar } from '../artifact-editor/SearchBar'
import { getPositionRelativeToEditor } from '../artifact-editor/editor-utils'
import { CommentPanel } from '../comments/CommentPanel'
import '../artifact-editor/artifact-editor.css'
import { KIND_CONFIG, getKindMeta, getTabsForArtifact } from './constants'
import { KIND_RESTRICTED_SECTIONS } from '../../lib/artifact-constants'
import { useArtifactCardState } from './useArtifactCardState'
import { ArtifactCardHeader } from './ArtifactCardHeader'
import { ArtifactCardBanners } from './ArtifactCardBanners'
import { LocalModeContent } from './LocalModeContent'
import { SharedModeContent } from './SharedModeContent'
import type { ArtifactCardProps } from './types'

export function ArtifactCard({
  workspaceId,
  kind,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onExpandedChange,
  focused = false,
  onToggleFocus,
}: ArtifactCardProps) {
  const state = useArtifactCardState(workspaceId, kind, {
    defaultExpanded,
    expanded: controlledExpanded,
    onExpandedChange,
  })
  const [commentPanelOpen, setCommentPanelOpen] = useState(false)
  const [localEditor, setLocalEditor] = useState<Editor | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const openLinkInputRef = useRef<(() => void) | null>(null)
  const contentScrollRef = useRef<HTMLDivElement>(null)

  const isShared = state.mode === 'shared'

  const authUser = useAuthStore((s) => s.user)
  const openBubble = useCommentBubbleStore((s) => s.openBubble)

  const {
    editor: yjsEditor,
    ydoc,
    provider,
  } = useYjsEditor({
    workspaceId,
    kind,
    enabled: isShared,
    userName: authUser ? [authUser.firstName, authUser.lastName].filter(Boolean).join(' ') || authUser.email : 'Anonymous',
  })

  const yjsArtifact = useYjsArtifact({ ydoc: isShared ? ydoc : null })
  const autoSave = useAutoSave(isShared ? provider : null)

  const commentsHook = useComments({
    ydoc: isShared ? ydoc : null,
    editor: isShared ? yjsEditor : null,
    userId: authUser?.id ?? 'anonymous',
    userFirstName: authUser?.firstName ?? null,
    userLastName: authUser?.lastName ?? null,
    userPicture: authUser?.profilePictureUrl ?? null,
    enabled: isShared,
  })

  const config = KIND_CONFIG[kind] ?? getKindMeta(kind)

  // Derive which array sections are present — filtered by kind restrictions
  const arraySections = useMemo(() => {
    const artifact = state.artifact
    if (!artifact) return []

    const allSections: Array<[string, unknown[]]> = [
      ['requirements', artifact.requirements],
      ['task_list', artifact.taskList],
      ['test_cases', artifact.testCases],
      ['security_checks', artifact.securityChecks],
      ['action_items', artifact.actionItems],
      ['spec_coverage', artifact.specCoverage],
      ['test_coverage', artifact.testCoverage],
      ['change_log', artifact.changeLog],
    ]

    return allSections
      .filter(([name, data]) => {
        if (!data || data.length === 0) return false
        const allowedKind = KIND_RESTRICTED_SECTIONS[name]
        return !allowedKind || allowedKind === kind
      })
      .map(([name]) => name)
  }, [state.artifact, kind])

  const tabs = getTabsForArtifact(kind, arraySections)

  const title = isShared
    ? (yjsArtifact.meta?.title || config.label)
    : (state.artifact?.meta.title || config.label)

  const toolbarEditor = isShared ? yjsEditor : localEditor

  const handleSearchOpen = useCallback(() => setSearchOpen(true), [])

  const cardClass = focused
    ? 'bg-surface overflow-clip flex flex-col h-full'
    : 'border border-border-subtle rounded-lg bg-surface overflow-clip'

  return (
    <div className={cardClass}>
      {/* ─── Header zone ─────────────────────────────────────── */}
      {/* Sticky so it pins while scrolling through content. */}
      <div className="sticky top-0 z-10 bg-surface" data-artifact-header>
        <ArtifactCardHeader
          kind={kind}
          title={title}
          expanded={state.expanded}
          onToggleExpand={() => state.setExpanded(!state.expanded)}
          mode={state.mode}
          onSetMode={state.setMode}
          saving={state.saving}
          serverSaved={state.serverSaved}
          autoSave={autoSave}
          isLoading={state.isLoading}
          isShared={isShared}
          onToggleCommentPanel={() => setCommentPanelOpen(!commentPanelOpen)}
          onPullLatest={state.pullLatest}
          onSave={() => state.saveToServer()}
          onReload={state.reload}
          focused={focused}
          onToggleFocus={onToggleFocus ?? (() => {})}
          artifactExists={!!state.artifact}
          hasValidationErrors={!!state.error}
          hasLocalChanges={state.hasLocalChanges}
          artifactStatus={state.artifactStatus}
          statusChangedByFirstName={state.statusChangedByFirstName}
          statusChangedByLastName={state.statusChangedByLastName}
          statusChangedAt={state.statusChangedAt}
          onStatusChange={state.updateStatus}
          editingTitle={state.editingTitle}
          titleDraft={state.titleDraft}
          titleInputRef={state.titleInputRef}
          onTitleDraftChange={state.setTitleDraft}
          onSaveTitle={state.saveTitle}
          onCancelEditTitle={() => state.setEditingTitle(false)}
          onStartEditTitle={state.startEditingTitle}
        />

        {state.expanded && tabs.length > 1 && (
          <div className="flex items-center gap-0 px-3 border-b border-border-subtle bg-surface">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`px-3 py-2 text-[12px] font-medium transition-colors border-b-2 ${
                  state.activeTab === tab.id
                    ? 'border-brand text-fg'
                    : 'border-transparent text-fg-tertiary hover:text-fg-secondary'
                }`}
                onClick={() => state.setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {state.expanded && state.activeTab === 'content' && (
          <EditorToolbar editor={toolbarEditor} onLinkClick={() => openLinkInputRef.current?.()} />
        )}

        {state.expanded && searchOpen && toolbarEditor && (
          <SearchBar editor={toolbarEditor} onClose={() => setSearchOpen(false)} />
        )}
      </div>

      {/* ─── Content zone ──────────────────────────────────────── */}
      {/* Content flows naturally, panel sticks on the right. */}
      {state.expanded && (
        <div className={`flex ${focused ? 'flex-1 overflow-y-auto' : ''}`}>
          <div
            ref={contentScrollRef}
            className="flex-1 min-w-0 relative"
          >
            <ArtifactCardBanners
              newerVersionAvailable={state.mode === 'local' && state.newerVersionAvailable}
              serverConflict={state.mode === 'local' && state.serverConflict}
              notSharedYet={state.mode === 'shared' && state.notSharedYet}
              error={state.error}
              onPullLatest={state.pullLatest}
              onDismissNewer={() => state.setNewerVersionAvailable(false)}
              onSaveAnyway={() => state.saveToServer(true)}
              onDismissConflict={() => state.setServerConflict(false)}
              onSwitchToLocal={() => state.setMode('local')}
            />

            {isShared ? (
              <SharedModeContent
                activeTab={state.activeTab}
                kind={kind}
                yjsEditor={yjsEditor}
                ydoc={ydoc}
                yjsArtifact={yjsArtifact}
                commentsHook={commentsHook}
                arraySections={arraySections}
                onSearchOpen={handleSearchOpen}
                onLinkInputReady={(fn) => { openLinkInputRef.current = fn }}
              />
            ) : (
              <div className="flex min-h-[120px]">
                <LocalModeContent
                  activeTab={state.activeTab}
                  kind={kind}
                  artifact={state.artifact}
                  isLoading={state.isLoading}
                  arraySections={arraySections}
                  onContentChange={state.handleContentChange}
                  onArrayChange={state.handleArrayChange}
                  onEditorReady={setLocalEditor}
                  onSearchOpen={handleSearchOpen}
                  onLinkInputReady={(fn) => { openLinkInputRef.current = fn }}
                />
              </div>
            )}
          </div>

          {/* Comment panel */}
          {isShared && commentPanelOpen && (
            <div className="sticky top-0 self-start h-[80vh]">
            <CommentPanel
              comments={commentsHook.comments}
              currentUserId={authUser?.id ?? 'anonymous'}
              onClickComment={(commentId) => {
                if (!yjsEditor) return
                const resolved = commentsHook.resolveCommentPositions()
                const target = resolved.find((r) => r.id === commentId)
                if (!target) return

                yjsEditor.commands.focus()
                yjsEditor.commands.setTextSelection({ from: target.pmFrom, to: target.pmTo })
                const domAtPos = yjsEditor.view.domAtPos(target.pmFrom)
                const node = domAtPos.node instanceof HTMLElement ? domAtPos.node : domAtPos.node.parentElement
                node?.scrollIntoView({ behavior: 'smooth', block: 'center' })

                const allAtRange = resolved.filter(
                  (c) => c.pmFrom <= target.pmTo && c.pmTo >= target.pmFrom
                )
                const position = getPositionRelativeToEditor(yjsEditor.view, target.pmFrom)
                if (position) {
                  openBubble({
                    mode: 'view',
                    position,
                    commentIds: allAtRange.map((c) => c.id),
                  })
                }
              }}
              onClose={() => setCommentPanelOpen(false)}
            />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
