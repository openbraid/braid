import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { AlertTriangle } from 'lucide-react'

type Props = {
  kind: string
  children: ReactNode
}

type State = {
  hasError: boolean
  error: string | null
}

export class ArtifactErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[artifact-error-boundary] ${this.props.kind} crashed:`, error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="border border-border-subtle rounded-lg bg-surface overflow-hidden">
          <div className="px-4 py-6 flex flex-col items-center gap-2">
            <AlertTriangle size={20} className="text-error opacity-60" />
            <span className="text-[13px] font-medium text-fg-secondary">
              {this.props.kind} failed to render
            </span>
            {this.state.error && (
              <span className="text-[11px] text-fg-tertiary max-w-md text-center">
                {this.state.error}
              </span>
            )}
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-1 text-[12px] text-brand hover:text-brand-hover transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
