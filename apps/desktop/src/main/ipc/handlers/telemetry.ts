import { Channels } from '../../../shared/ipc-types'
import { handleIpc } from '../handle-ipc'
import { isTelemetryEnabled } from '../../services/telemetry'

export function registerTelemetryHandlers(): void {
  handleIpc(Channels.TELEMETRY_IS_ENABLED, () => {
    return isTelemetryEnabled()
  })
}
