import { getPort } from 'get-port-please'

const usedPorts = new Set<number>()

/**
 * The interface every server we allocate a port for actually binds.
 *
 * This must be passed explicitly. get-port-please defaults to binding the
 * IPv6 wildcard when probing, and on macOS `[::]:P` binds successfully while
 * `127.0.0.1:P` is occupied — so a port held by a leftover IPv4-only listener
 * is reported free, we hand it out, and the process we spawn dies with
 * EADDRINUSE while the old listener keeps answering on it.
 */
const BIND_HOST = '127.0.0.1'

export async function allocatePort(): Promise<number> {
  try {
    let port = await getPort({ host: BIND_HOST, portRange: [49200, 52000] })
    // If already allocated in this process, scan forward until we find a free one
    while (usedPorts.has(port)) {
      port = await getPort({ host: BIND_HOST, portRange: [port + 1, 52000] })
    }
    usedPorts.add(port)
    return port
  } catch {
    throw new Error('Could not allocate a port for VS Code. Try closing some projects.')
  }
}

export function releasePort(port: number): void {
  usedPorts.delete(port)
}
