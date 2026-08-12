import React from 'react'
import { Terminal } from './Terminal'

export function App(): React.ReactElement {
  const params = new URLSearchParams(window.location.search)
  const terminalId = params.get('terminalId')

  if (!terminalId) {
    return (
      <div style={{ color: '#888', padding: 20, fontFamily: 'monospace' }}>
        Missing terminalId parameter
      </div>
    )
  }

  return <Terminal terminalId={terminalId} />
}
