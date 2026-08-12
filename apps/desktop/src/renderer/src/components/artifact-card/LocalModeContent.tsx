import { Layers } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import type { ArtifactKind } from '../../../../shared/ipc-types'
import type { ParsedArtifact } from '../../lib/artifact-parser'
import type { StructuredItem } from '../../hooks/useYjsArtifact'
import { ArtifactEditor } from '../artifact-editor/ArtifactEditor'
import { StructuredTable } from './StructuredTable'
import { ChangelogView } from './ChangelogView'
import { getPrimarySection } from './constants'
import type { TabId } from './constants'

type LocalModeContentProps = {
  activeTab: TabId
  kind: ArtifactKind
  artifact: ParsedArtifact | undefined
  isLoading: boolean
  arraySections: string[]
  onContentChange: (markdown: string) => void
  onArrayChange: (arrayName: string, items: Record<string, unknown>[]) => void
  onEditorReady?: (editor: Editor) => void
  onSearchOpen?: () => void
  onLinkInputReady?: (openFn: () => void) => void
}

/** Map ParsedArtifact arrays to generic StructuredItem[] by section name */
const SECTION_FIELD_MAP: Record<string, keyof ParsedArtifact> = {
  requirements: 'requirements',
  task_list: 'taskList',
  spec_coverage: 'specCoverage',
  test_cases: 'testCases',
  security_checks: 'securityChecks',
  action_items: 'actionItems',
  test_coverage: 'testCoverage',
  change_log: 'changeLog',
}

function getArrayData(artifact: ParsedArtifact | undefined, arrayName: string): StructuredItem[] {
  if (!artifact) return []
  const field = SECTION_FIELD_MAP[arrayName]
  if (!field) return []
  const data = artifact[field]
  return Array.isArray(data) ? (data as unknown as StructuredItem[]) : []
}

export function LocalModeContent({
  activeTab,
  kind,
  artifact,
  isLoading,
  arraySections,
  onContentChange,
  onArrayChange,
  onEditorReady,
  onSearchOpen,
  onLinkInputReady,
}: LocalModeContentProps) {
  const contextMarkdown = artifact?.contextBlocks.join('\n\n') ?? ''
  const primarySection = getPrimarySection(kind)

  return (
    <div className="flex-1 min-w-0">
      {activeTab === 'content' && (
        artifact ? (
          <>
            <ArtifactEditor
              content={contextMarkdown}
              onChange={onContentChange}
              onEditorReady={onEditorReady}
              onSearchOpen={onSearchOpen}
              onLinkInputReady={onLinkInputReady}
            />
            {/* Primary work table (lives with context) */}
            {primarySection && (
              <StructuredTable
                items={getArrayData(artifact, primarySection)}
                arrayName={primarySection}
                onChange={(items) => onArrayChange(primarySection, items)}
              />
            )}
          </>
        ) : !isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Layers size={24} className="text-fg-tertiary opacity-40" />
            <span className="text-[12px] text-fg-tertiary">No content yet</span>
          </div>
        ) : null
      )}

      {/* Changelog tab */}
      {activeTab === 'changelog' && (
        <ChangelogView entries={artifact?.changeLog ?? []} />
      )}

      {/* Additional array section tabs */}
      {activeTab !== 'content' && activeTab !== 'changelog' && arraySections.includes(activeTab) && (
        <StructuredTable
          items={getArrayData(artifact, activeTab)}
          arrayName={activeTab}
          onChange={(items) => onArrayChange(activeTab, items)}
        />
      )}
    </div>
  )
}
