import type { ArtifactKind } from '../../../shared/ipc-types'

/**
 * Returns a seed YAML string for a given artifact kind.
 * Templates include one example item per array section so AI agents
 * can see the expected fields and structure. Example items are prefixed
 * with "Example:" so users know to replace them.
 */
export function getArtifactTemplate(kind: ArtifactKind): string {
  switch (kind) {
    case 'REQUIREMENTS':
      return `meta:
  kind: REQUIREMENTS
  title: ""

context: |

requirements:
  - id: REQ-001
    title: "Example: User login"
    status: proposed
    priority: p1
    description: |
      Users can log in with email and password.

      ## Acceptance criteria
      - Invalid credentials show error message
      - Session persists for 7 days

change_log: []
`

    case 'DESIGN':
      return `meta:
  kind: DESIGN
  title: ""

context: |

change_log: []
`

    case 'SPEC':
      return `meta:
  kind: SPEC
  title: ""

context: |

task_list:
  - id: TASK-001
    title: "Example: Implement login endpoint"
    status: todo
    related_requirement: REQ-001
    description: |
      ## What needs to be done
      - Validate credentials
      - Return JWT on success

spec_coverage:
  - id: SC-001
    title: "Example: Login endpoint coverage"
    requirement_id: REQ-001
    coverage: covered
    gaps: ""

change_log: []
`

    case 'TEST_PLAN':
      return `meta:
  kind: TEST_PLAN
  title: ""

context: |

test_cases:
  - id: TC-001
    title: "Example: Valid login returns token"
    status: todo
    related_requirement: REQ-001
    description: |
      ## Scenario
      - Given valid email and password
      - POST /auth/login returns 200 with JWT

test_coverage:
  - id: COV-001
    title: "Example: Login test coverage"
    requirement_id: REQ-001
    coverage: covered
    gaps: ""

change_log: []
`

    default:
      return `meta:
  kind: ${kind}
  title: ""

context: |

change_log: []
`
  }
}

/** Default pipeline for new workspaces when no project-level config exists. */
export const DEFAULT_PIPELINE: ArtifactKind[] = ['REQUIREMENTS', 'DESIGN', 'SPEC']
