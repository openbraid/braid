import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { TooltipProvider } from './components/ui/Tooltip'
import { initAnalytics } from './lib/analytics'

// Opt-in: resolves to a no-op unless telemetryEnabled is true in config.json.
// Not awaited — rendering must not wait on an IPC round trip, and every
// analytics call is inert until this resolves and (maybe) enables the SDK.
void initAnalytics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider delayDuration={400}>
      <App />
    </TooltipProvider>
  </StrictMode>
)
