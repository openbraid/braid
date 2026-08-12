import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import { BraidMark } from '../ui/BraidMark'

export type LoadingStep = {
  label: string
  status: 'pending' | 'active' | 'done' | 'error'
}

type Props = {
  steps: LoadingStep[]
}

function StepIcon({ status }: { status: LoadingStep['status'] }) {
  if (status === 'done')    return <CheckCircle2 size={13} className="text-success shrink-0" />
  if (status === 'active')  return <Loader2     size={13} className="text-fg-secondary shrink-0 animate-spin" />
  if (status === 'error')   return <XCircle     size={13} className="text-error shrink-0" />
  return                           <Circle      size={13} className="text-fg-tertiary shrink-0" />
}

export function LoadingScreen({ steps }: Props) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-page">
      <BraidMark size={32} className="animate-pulse" />

      <p className="text-[14px] text-fg-secondary mt-4">
        Setting up your workspace...
      </p>

      <div className="flex flex-col gap-2 mt-6">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2">
            <StepIcon status={step.status} />
            <span
              className={[
                'text-[13px]',
                step.status === 'pending' ? 'text-fg-tertiary' : 'text-fg',
                step.status === 'error'   ? 'text-error'       : ''
              ].join(' ')}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
