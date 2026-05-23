'use client'

export type VoiceCharacter = 'neural' | 'orb' | 'ripple' | 'bars' | 'blob'

export const VOICE_CHARACTERS: { id: VoiceCharacter; label: string; description: string }[] = [
  { id: 'neural', label: 'Neural',  description: 'Brainwave pulse' },
  { id: 'orb',    label: 'Orb',     description: 'Breathing sphere' },
  { id: 'ripple', label: 'Ripple',  description: 'Sonar rings' },
  { id: 'bars',   label: 'Bars',    description: 'Audio spectrum' },
  { id: 'blob',   label: 'Blob',    description: 'Morphing shape' },
]

interface AnimProps {
  isActive: boolean
  size?: number
}

/* ── 1. Neural Pulse (d1 — default) ─────────────────────────────────────── */
// Scrolling EEG / brainwave recording line — two identical waveform periods
// side by side; translateX(-50%) at loop end makes it seamless.
export function NeuralAnimation({ isActive, size = 48 }: AnimProps) {
  const h = size
  const w = size * 2.4
  const mid = h / 2
  // One period of a brainwave-like path (relative to 0..120 x-space)
  const period = (ox: number) =>
    `L${ox + 8},${mid} L${ox + 11},${mid * 0.25} L${ox + 14},${mid * 1.75} ` +
    `L${ox + 17},${mid * 0.6} L${ox + 20},${mid * 1.4} L${ox + 23},${mid} ` +
    `L${ox + 35},${mid} L${ox + 38},${mid * 0.35} L${ox + 41},${mid * 1.65} ` +
    `L${ox + 44},${mid * 0.5} L${ox + 47},${mid * 1.5} L${ox + 50},${mid} ` +
    `L${ox + 60},${mid}`

  const d = `M0,${mid} ${period(0)} ${period(60)}`

  return (
    <div
      style={{
        width: size,
        height: h,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
      }}
    >
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        style={{
          position: 'absolute',
          left: 0,
          animation: isActive
            ? 'neural-scroll 1.1s linear infinite'
            : 'neural-idle 2.4s ease-in-out infinite',
          flexShrink: 0,
        }}
      >
        <path
          d={d}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={isActive ? 2.2 : 1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={isActive ? 1 : 0.45}
        />
        {/* Glow duplicate */}
        {isActive && (
          <path
            d={d}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.18}
          />
        )}
      </svg>
    </div>
  )
}

/* ── 2. Orb ─────────────────────────────────────────────────────────────── */
export function OrbAnimation({ isActive, size = 48 }: AnimProps) {
  const c = size / 2
  const r = size * 0.28

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      {/* Expanding rings — only when active */}
      {isActive && [0.6, 1.2, 1.8].map((delay) => (
        <circle key={delay} cx={c} cy={c} r={r}
          fill="none" stroke="var(--primary)" strokeWidth={1.2}
          style={{ animation: `orb-ring 1.8s ease-out ${delay}s infinite` }}
        />
      ))}
      {/* Core orb */}
      <circle
        cx={c} cy={c} r={r}
        fill="var(--primary)"
        opacity={isActive ? 0.95 : 0.4}
        style={{
          animation: isActive
            ? 'orb-pulse 1.2s ease-in-out infinite'
            : 'idle-breathe 3s ease-in-out infinite',
          transformOrigin: `${c}px ${c}px`,
        }}
      />
      {/* Highlight */}
      <circle
        cx={c - r * 0.28} cy={c - r * 0.28} r={r * 0.28}
        fill="white"
        opacity={0.3}
        style={{ pointerEvents: 'none' }}
      />
    </svg>
  )
}

/* ── 3. Ripple ───────────────────────────────────────────────────────────── */
export function RippleAnimation({ isActive, size = 48 }: AnimProps) {
  const c = size / 2
  const r = size * 0.09

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      {/* Ripple rings */}
      {isActive
        ? [0, 0.55, 1.1].map((delay) => (
            <circle key={delay} cx={c} cy={c} r={r}
              fill="none" stroke="var(--primary)" strokeWidth={1.4}
              style={{ animation: `ripple-expand 1.65s ease-out ${delay}s infinite`, transformOrigin: `${c}px ${c}px` }}
            />
          ))
        : [0.9, 0.65].map((op, i) => (
            <circle key={i} cx={c} cy={c}
              r={r + (i + 1) * size * 0.11}
              fill="none" stroke="var(--primary)" strokeWidth={1}
              opacity={op * 0.35}
            />
          ))
      }
      {/* Centre dot */}
      <circle
        cx={c} cy={c} r={r}
        fill="var(--primary)"
        opacity={isActive ? 1 : 0.45}
        style={isActive ? {} : { animation: 'idle-breathe 2.8s ease-in-out infinite', transformOrigin: `${c}px ${c}px` }}
      />
    </svg>
  )
}

/* ── 4. Bars ─────────────────────────────────────────────────────────────── */
export function BarsAnimation({ isActive, size = 48 }: AnimProps) {
  const barCount = 7
  const gap = size * 0.06
  const totalGap = gap * (barCount - 1)
  const barW = (size - totalGap) / barCount
  const maxH = size * 0.88
  const animations = [
    'bar-dance-1', 'bar-dance-2', 'bar-dance-3', 'bar-dance-4',
    'bar-dance-5', 'bar-dance-6', 'bar-dance-7',
  ]
  const idleHeights = [0.35, 0.6, 0.45, 0.7, 0.3, 0.55, 0.4]

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      {Array.from({ length: barCount }).map((_, i) => {
        const x = i * (barW + gap)
        const staticH = idleHeights[i] * maxH
        return (
          <rect
            key={i}
            x={x}
            rx={barW / 2}
            fill="var(--primary)"
            opacity={isActive ? 0.9 : 0.35}
            width={barW}
            style={
              isActive
                ? {
                    animation: `${animations[i]} ${0.65 + i * 0.07}s ease-in-out ${i * 0.08}s infinite`,
                    height: `${maxH * 0.5}px`,
                    y: `${size - maxH * 0.5}px`,
                    transformOrigin: `${x + barW / 2}px ${size}px`,
                  }
                : {
                    height: `${staticH}px`,
                    y: `${size - staticH}px`,
                  }
            }
          />
        )
      })}
    </svg>
  )
}

/* ── 5. Blob ─────────────────────────────────────────────────────────────── */
export function BlobAnimation({ isActive, size = 48 }: AnimProps) {
  const c = size / 2
  const r = size * 0.32

  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: r * 2,
          height: r * 2,
          background: 'var(--primary)',
          opacity: isActive ? 0.92 : 0.38,
          animation: isActive
            ? 'blob-morph 2.8s ease-in-out infinite'
            : 'idle-breathe 3.2s ease-in-out infinite',
          borderRadius: '60% 40% 65% 35% / 55% 60% 40% 45%',
          transformOrigin: 'center',
        }}
      />
    </div>
  )
}

/* ── Unified renderer ────────────────────────────────────────────────────── */
export function VoiceAnimationDisplay({
  character,
  isActive,
  size = 48,
}: {
  character: VoiceCharacter
  isActive: boolean
  size?: number
}) {
  switch (character) {
    case 'neural':  return <NeuralAnimation isActive={isActive} size={size} />
    case 'orb':     return <OrbAnimation    isActive={isActive} size={size} />
    case 'ripple':  return <RippleAnimation isActive={isActive} size={size} />
    case 'bars':    return <BarsAnimation   isActive={isActive} size={size} />
    case 'blob':    return <BlobAnimation   isActive={isActive} size={size} />
  }
}
