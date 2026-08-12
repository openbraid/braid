import { defineConfig } from 'vitest/config'

// ─── Vitest config ───────────────────────────────────────────────────────────
//
// Tests live next to nothing — they all sit under `tests/`, mirroring the
// `src/` tree. Keeping them out of `src/` means the electron-vite builds and
// the two tsconfig projects stay untouched: no test file ever ships in a bundle.
//
// The environment is `node` because everything currently under test is main
// process code (pure libs and services). A renderer suite would need its own
// project entry with a DOM environment — add it then, not pre-emptively.

export default defineConfig({
  test: {
    environment: 'node',
    // Tests live beside the code they cover. There is no top-level tests/ dir.
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    // Electron and better-sqlite3 are native/host-only; nothing under test may
    // reach them. If a test starts needing them, mock the module instead of
    // loosening this.
    restoreMocks: true,
    clearMocks: true
  }
})
