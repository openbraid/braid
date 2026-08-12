// Real-time waveform visualization for the dictation bar.
// Renders frequency bars from volume level data streamed via WebSocket.

import React, { useEffect, useRef, useMemo } from 'react'
import { getDictationColors } from './theme'
import type { ThemeKind } from '../../shared/theme'

type Props = {
  levels: number[]
  isActive: boolean
  themeKind: ThemeKind
}

const BAR_WIDTH = 1
const BAR_GAP = 1
const BAR_MIN_HEIGHT = 1

export function Waveform({ levels, isActive, themeKind }: Props): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const colors = useMemo(() => getDictationColors(themeKind), [themeKind])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height

    ctx.clearRect(0, 0, width, height)

    if (!isActive || levels.length === 0) return

    const numBars = Math.floor(width / (BAR_WIDTH + BAR_GAP))
    const step = Math.max(1, Math.floor(levels.length / numBars))

    for (let i = 0; i < numBars; i++) {
      const value = levels[i * step] ?? 0
      const barHeight = Math.max(BAR_MIN_HEIGHT, (value / 255) * height * 0.9)

      const x = i * (BAR_WIDTH + BAR_GAP)
      const y = (height - barHeight) / 2

      ctx.fillStyle = value > 20 ? colors.waveformActive : colors.waveformDim
      ctx.fillRect(x, y, BAR_WIDTH, barHeight)
    }
  }, [levels, isActive, colors])

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={24}
      style={{
        width: '100%',
        height: '24px',
        display: 'block'
      }}
    />
  )
}
