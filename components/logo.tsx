export interface BrainGlyphProps {
  size?: number
  color?: string
  filled?: boolean
  eyes?: boolean
}

export function BrainGlyph({ size = 28, color = 'var(--violet)', filled = false, eyes = true }: BrainGlyphProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-label="BrainDump" fill="none">
      <defs>
        <linearGradient id="bg-glyph-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--violet)" />
          <stop offset="100%" stopColor="var(--violet-deep)" />
        </linearGradient>
      </defs>
      <path
        d="M16 4 C 11 3.5, 7 5.5, 6.5 9 C 4 9.5, 3 12, 4 14.5 C 2.5 16.5, 3.5 20, 6.5 21 C 7.5 24.5, 11 26, 13.5 25 C 14 27, 18 27, 18.5 25 C 21 26, 24.5 24.5, 25.5 21 C 28.5 20, 29.5 16.5, 28 14.5 C 29 12, 28 9.5, 25.5 9 C 25 5.5, 21 3.5, 16 4 Z"
        fill={filled ? 'url(#bg-glyph-grad)' : 'none'}
        stroke={filled ? 'none' : color}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {filled && (
        <ellipse cx="12" cy="9" rx="5" ry="2.4" fill="white" opacity="0.30" transform="rotate(-18 12 9)" />
      )}
      {eyes && (
        <g>
          <circle cx="12" cy="15.5" r="2.2" fill={filled ? 'white' : color} />
          <circle cx="20" cy="15.5" r="2.2" fill={filled ? 'white' : color} />
          <circle cx="12.6" cy="14.8" r="0.7" fill={filled ? 'var(--violet)' : 'white'} opacity="0.95" />
          <circle cx="20.6" cy="14.8" r="0.7" fill={filled ? 'var(--violet)' : 'white'} opacity="0.95" />
        </g>
      )}
    </svg>
  )
}

interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
}

export function Logo({ size = 'md' }: LogoProps) {
  const sizes = {
    sm: { glyph: 22, font: 16, gap: 8 },
    md: { glyph: 32, font: 22, gap: 10 },
    lg: { glyph: 52, font: 36, gap: 14 },
  }
  const s = sizes[size]
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: s.gap }}>
      <BrainGlyph size={s.glyph} filled />
      <span style={{
        fontFamily: 'var(--display)',
        fontSize: s.font,
        fontWeight: 600,
        letterSpacing: '-0.02em',
        color: 'var(--ink)',
        lineHeight: 1,
      }}>
        braindump<span style={{ color: 'var(--violet)' }}>.</span>
      </span>
    </div>
  )
}
