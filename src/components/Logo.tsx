/**
 * CineTrack brand marks. The logomark is two overlapping lenses — a pink and a
 * blue disc — taken from branding/Logo.svg. `Mark` is the standalone glyph;
 * `Logo` pairs it with the wordmark for headers and the landing page.
 */

const PINK = '#D93D87'
const BLUE = '#263C92'

export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  // Native ratio is 170×100 (two r=50 discs at cx 50 and 120).
  const height = (size * 100) / 170
  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 170 100"
      fill="none"
      role="img"
      aria-label="CineTrack"
      className={className}
      // Isolate so the discs' multiply blend applies only to each other,
      // not the page — otherwise it crushes to black on dark themes.
      style={{ isolation: 'isolate' }}
    >
      {/* multiply blend so the overlap deepens the way the source art does */}
      <circle cx="50" cy="50" r="50" fill={PINK} />
      <circle cx="120" cy="50" r="50" fill={BLUE} style={{ mixBlendMode: 'multiply' }} />
    </svg>
  )
}

export function Logo({
  size = 26,
  markSize,
  className,
  wordmark = true,
}: {
  size?: number
  markSize?: number
  className?: string
  wordmark?: boolean
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <Mark size={markSize ?? size} />
      {wordmark && (
        <span
          className="font-display italic leading-none tracking-tight text-foreground"
          style={{ fontSize: size * 1.02 }}
        >
          CineTrack
        </span>
      )}
    </span>
  )
}
