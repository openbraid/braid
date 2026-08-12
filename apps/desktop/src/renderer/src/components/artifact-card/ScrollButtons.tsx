// ─── ScrollButtons ───────────────────────────────────────────────────────────
// Floating jump-to-top / jump-to-bottom buttons on the right edge of a
// scrollable container. Shows the relevant button based on scroll position.

import { useState, useEffect, useCallback, type RefObject } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'

interface ScrollButtonsProps {
  scrollRef: RefObject<HTMLDivElement | null>
}

export function ScrollButtons({ scrollRef }: ScrollButtonsProps) {
  const [showTop, setShowTop] = useState(false)
  const [showBottom, setShowBottom] = useState(false)

  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    const { scrollTop, scrollHeight, clientHeight } = el
    const scrollableDistance = scrollHeight - clientHeight

    // Only show buttons if there's meaningful scroll distance
    if (scrollableDistance < 100) {
      setShowTop(false)
      setShowBottom(false)
      return
    }

    setShowTop(scrollTop > 100)
    setShowBottom(scrollTop < scrollableDistance - 100)
  }, [scrollRef])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', checkScroll, { passive: true })
    checkScroll() // initial check
    return () => el.removeEventListener('scroll', checkScroll)
  }, [scrollRef, checkScroll])

  function scrollToTop() {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function scrollToBottom() {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  return (
    <>
      {showTop && (
        <button
          onClick={scrollToTop}
          className="absolute top-2 right-3 z-10 p-1.5 rounded-md bg-surface border border-border-subtle shadow-sm text-fg-tertiary hover:text-fg hover:bg-surface-hover transition-all opacity-70 hover:opacity-100"
          title="Scroll to top"
        >
          <ChevronUp size={14} />
        </button>
      )}
      {showBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-2 right-3 z-10 p-1.5 rounded-md bg-surface border border-border-subtle shadow-sm text-fg-tertiary hover:text-fg hover:bg-surface-hover transition-all opacity-70 hover:opacity-100"
          title="Scroll to bottom"
        >
          <ChevronDown size={14} />
        </button>
      )}
    </>
  )
}
