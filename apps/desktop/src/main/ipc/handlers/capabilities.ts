import { Channels } from '../../../shared/ipc-types'
import { handleIpc } from '../handle-ipc'
import { getCapabilities } from '../../services/capabilities'

export function registerCapabilityHandlers(): void {
  handleIpc(Channels.CAPABILITIES_GET, () => {
    return getCapabilities()
  })
}
