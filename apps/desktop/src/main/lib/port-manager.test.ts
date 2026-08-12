import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:net'

// ─── Port manager ────────────────────────────────────────────────────────────
//
// `usedPorts` is module-level state with no reset hook, so every test re-imports
// the module through `vi.resetModules()` to get a clean set. Importing statically
// would leak allocations between tests and make the "never hands out the same
// port twice" assertion depend on execution order.

const PORT_RANGE_START = 49200
const PORT_RANGE_END = 52000

type PortManager = typeof import('./port-manager')

async function freshModule(): Promise<PortManager> {
  vi.resetModules()
  return import('./port-manager')
}

/** Binds a real IPv4-loopback listener, exactly like the servers we allocate for. */
function occupy(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

describe('port-manager', () => {
  const servers: Server[] = []

  beforeEach(() => {
    servers.length = 0
  })

  afterEach(async () => {
    // Leaking a listener would poison the range for every later test in the run.
    await Promise.all(servers.map(close))
    servers.length = 0
  })

  describe('allocatePort', () => {
    it('returns a port inside the configured range', async () => {
      const { allocatePort } = await freshModule()

      const port = await allocatePort()

      expect(port).toBeGreaterThanOrEqual(PORT_RANGE_START)
      expect(port).toBeLessThanOrEqual(PORT_RANGE_END)
      expect(Number.isInteger(port)).toBe(true)
    })

    it('never returns a port already bound on 127.0.0.1', async () => {
      // Regression test for the embedded-editor bug: the availability probe used
      // to default to the IPv6 wildcard. On macOS `[::]:P` binds successfully
      // while `127.0.0.1:P` is occupied, so an occupied port was reported free,
      // handed out, and the spawned server died with EADDRINUSE while a stale
      // IPv4 listener kept answering on it.
      //
      // The port is discovered rather than hard-coded: a first allocation on a
      // clean module tells us which port the allocator naturally prefers on this
      // machine, and that is the one we then occupy. Hard-coding a number would
      // make the test pass vacuously wherever that number happened to be busy.
      const probe = await freshModule()
      const contested = await probe.allocatePort()

      servers.push(await occupy(contested))

      const { allocatePort } = await freshModule()
      const allocated = [
        await allocatePort(),
        await allocatePort(),
        await allocatePort(),
        await allocatePort(),
        await allocatePort()
      ]

      expect(allocated).not.toContain(contested)

      // The contested port is the sharpest case, but the invariant is broader:
      // anything handed out must actually be bindable on the interface our
      // servers use. An IPv6-wildcard probe can also clear a *lower* port that
      // some unrelated IPv4-only process on this machine already holds, and that
      // failure looks identical in production.
      for (const port of allocated) {
        const server = await occupy(port)
        servers.push(server)
      }
    })

    it('never returns the same port twice within a run', async () => {
      const { allocatePort } = await freshModule()

      const ports = [
        await allocatePort(),
        await allocatePort(),
        await allocatePort(),
        await allocatePort(),
        await allocatePort()
      ]

      expect(new Set(ports).size).toBe(ports.length)
    })

    it('keeps a port reserved even after nothing binds it', async () => {
      // The reservation is bookkeeping only — no listener is ever created — so
      // the guard has to come from `usedPorts`, not from the OS.
      const { allocatePort } = await freshModule()

      const first = await allocatePort()
      const second = await allocatePort()

      expect(second).not.toBe(first)
    })
  })

  describe('releasePort', () => {
    it('makes a previously allocated port available again', async () => {
      const { allocatePort, releasePort } = await freshModule()

      const first = await allocatePort()
      releasePort(first)
      const second = await allocatePort()

      // With the reservation dropped, the allocator prefers the same port again.
      expect(second).toBe(first)
    })

    it('is a no-op for a port that was never allocated', async () => {
      const { allocatePort, releasePort } = await freshModule()

      expect(() => releasePort(50999)).not.toThrow()

      const port = await allocatePort()
      expect(port).toBeGreaterThanOrEqual(PORT_RANGE_START)
    })

    it('does not resurrect other reservations', async () => {
      const { allocatePort, releasePort } = await freshModule()

      const first = await allocatePort()
      const second = await allocatePort()
      releasePort(first)
      const third = await allocatePort()

      expect(third).toBe(first)
      expect(third).not.toBe(second)
    })
  })
})
