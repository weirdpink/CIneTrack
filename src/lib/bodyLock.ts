import { useEffect } from 'react'

let count = 0
let prevOverflow: string | null = null
let prevPaddingRight: string | null = null

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    if (typeof document === 'undefined') return
    if (count === 0) {
      prevOverflow = document.body.style.overflow
      prevPaddingRight = document.body.style.paddingRight
      // compensate scrollbar gutter to avoid layout shift
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
      document.body.style.overflow = 'hidden'
      if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`
    }
    count++
    return () => {
      count = Math.max(0, count - 1)
      if (count === 0 && typeof document !== 'undefined') {
        document.body.style.overflow = prevOverflow ?? ''
        document.body.style.paddingRight = prevPaddingRight ?? ''
        prevOverflow = null
        prevPaddingRight = null
      }
    }
  }, [locked])
}
