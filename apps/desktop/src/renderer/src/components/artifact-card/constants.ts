import {
  ClipboardList,
  PenTool,
  Code2,
  TestTube2,
  Shield,
  FileText,
  BookOpen,
  SearchCode,
  type LucideIcon
} from 'lucide-react'
import { createElement } from 'react'
import type { ArtifactKind } from '../../../../shared/ipc-types'

// ─── Kind config ─────────────────────────────────────────────────────────────

export interface KindMeta {
  icon: React.ReactNode
  Icon: LucideIcon
  label: string
}

export const KIND_CONFIG: Record<string, KindMeta> = {
  REQUIREMENTS: { icon: createElement(ClipboardList, { size: 13 }), Icon: ClipboardList, label: 'Requirements' },
  DESIGN: { icon: createElement(PenTool, { size: 13 }), Icon: PenTool, label: 'Design' },
  SPEC: { icon: createElement(Code2, { size: 13 }), Icon: Code2, label: 'Spec' },
  TEST_PLAN: { icon: createElement(TestTube2, { size: 13 }), Icon: TestTube2, label: 'Test Plan' },
  SECURITY: { icon: createElement(Shield, { size: 13 }), Icon: Shield, label: 'Security' },
  RELEASE_NOTES: { icon: createElement(FileText, { size: 13 }), Icon: FileText, label: 'Release Notes' },
  USER_GUIDE: { icon: createElement(BookOpen, { size: 13 }), Icon: BookOpen, label: 'User Guide' },
  RCA: { icon: createElement(SearchCode, { size: 13 }), Icon: SearchCode, label: 'Root Cause Analysis' },
}

/**
 * Canonical SDLC order for all known kinds.
 * Used to determine the "correct" position when a known kind appears
 * in the workspace but wasn't in the user's configured pipeline.
 * RCA is first — incidents feed back into the cycle.
 */
export const KNOWN_KIND_ORDER: ArtifactKind[] = [
  'RCA',
  'REQUIREMENTS',
  'DESIGN',
  'SPEC',
  'TEST_PLAN',
  'SECURITY',
  'RELEASE_NOTES',
  'USER_GUIDE',
]

/** Get a kind's config, with fallback for unknown/custom kinds. */
export function getKindMeta(kind: string): KindMeta {
  return KIND_CONFIG[kind] ?? {
    icon: createElement(FileText, { size: 13 }),
    Icon: FileText,
    label: kind.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  }
}

// ─── Tab definitions ─────────────────────────────────────────────────────────

export type TabId = string  // 'content' | 'changelog' | any array section name

export interface TabDef {
  id: TabId
  label: string
  /** Array section name this tab renders (undefined for content/changelog) */
  arraySection?: string
}

/**
 * Sections that live on the Content tab (first array section).
 * Mapped by artifact kind → which section is the "primary work table."
 * If a section isn't listed here, it gets its own tab.
 */
const PRIMARY_SECTIONS: Record<string, string> = {
  REQUIREMENTS: 'requirements',
  SPEC: 'task_list',
  TEST_PLAN: 'test_cases',
  SECURITY: 'security_checks',
  RCA: 'action_items',
}

/** Human-readable labels for array sections */
export const SECTION_LABELS: Record<string, string> = {
  requirements: 'Requirements',
  task_list: 'Tasks',
  test_cases: 'Test Cases',
  security_checks: 'Security Checks',
  action_items: 'Action Items',
  spec_coverage: 'Spec Coverage',
  test_coverage: 'Test Coverage',
  change_log: 'Changelog',
}

/**
 * Generate tabs dynamically from the artifact's YAML sections.
 * - Content tab always first (context + primary work table)
 * - Additional array sections each get their own tab
 * - Changelog always last
 */
export function getTabsForArtifact(
  kind: string,
  arraySections: string[],
): TabDef[] {
  const tabs: TabDef[] = [{ id: 'content', label: 'Content' }]

  const primarySection = PRIMARY_SECTIONS[kind]

  for (const section of arraySections) {
    // Primary section lives on Content tab (not its own tab)
    if (section === primarySection) continue
    // Changelog is always last, handled below
    if (section === 'change_log') continue

    const label = SECTION_LABELS[section] ??
      section.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

    tabs.push({ id: section, label, arraySection: section })
  }

  // Changelog always last
  if (arraySections.includes('change_log')) {
    tabs.push({ id: 'changelog', label: 'Changelog' })
  }

  return tabs
}

/**
 * Get the primary array section for a kind (renders on Content tab).
 * Returns undefined for context-only kinds like DESIGN.
 */
export function getPrimarySection(kind: string): string | undefined {
  return PRIMARY_SECTIONS[kind]
}

