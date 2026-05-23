'use client'

import { useEffect, useRef, useState } from 'react'

export type BrainMascotState = 'idle' | 'listening' | 'thinking' | 'happy'

interface BrainMascotProps {
  size?: number
  state?: BrainMascotState
  audio?: number
  color?: string
  showHalo?: boolean
  bars?: number
  className?: string
  style?: React.CSSProperties
}

const BRAIN_SHAPE =
  'M 100 36 C 78 30, 56 38, 52 60 C 38 60, 28 78, 36 96 C 24 108, 28 132, 46 142 ' +
  'C 52 162, 78 170, 92 158 C 95 168, 105 168, 108 158 C 122 170, 148 162, 154 142 ' +
  'C 172 132, 176 108, 164 96 C 172 78, 162 60, 148 60 C 144 38, 122 30, 100 36 Z'

export function BrainMascot({
  size = 240,
  state = 'idle',
  audio,
  color = 'var(--violet)',
  showHalo = true,
  bars = 28,
  className,
  style,
}: BrainMascotProps) {
  const [t, setT] = useState(0)
  const [blinkPhase, setBlinkPhase] = useState(1)
  const [lookAt, setLookAt] = useState<[number, number]>([0, 0])
  const startedAt = useRef<number>(0)
  const audioRef = useRef(0)
  const peaksRef = useRef<number[]>(Array(bars).fill(0))

  // Animation loop
  useEffect(() => {
    let raf: number
    let last = performance.now()
    startedAt.current = last

    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setT((now - startedAt.current) / 1000)

      let target = audio
      if (target == null) {
        if (state === 'listening') {
          target = Math.max(0,
            0.34 + 0.45 * Math.sin(now * 0.012) +
            0.22 * Math.sin(now * 0.041 + 1.2) +
            Math.random() * 0.16 - 0.06
          )
        } else if (state === 'thinking') {
          target = 0.16 + 0.05 * Math.sin(now * 0.005)
        } else if (state === 'happy') {
          target = 0.18 + 0.10 * Math.sin(now * 0.008)
        } else {
          target = 0
        }
      }
      audioRef.current += (target - audioRef.current) * Math.min(1, dt * 6)
      const peaks = peaksRef.current
      peaks.unshift(Math.max(0, audioRef.current + (Math.random() - 0.5) * 0.08))
      peaks.length = bars
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [state, audio, bars])

  // Blink schedule
  useEffect(() => {
    let alive = true
    const next = () => {
      if (!alive) return
      setTimeout(() => {
        if (!alive) return
        setBlinkPhase(0)
        setTimeout(() => { if (alive) { setBlinkPhase(1); next() } }, 120)
        if (Math.random() < 0.22) {
          setTimeout(() => { if (alive) setBlinkPhase(0) }, 240)
          setTimeout(() => { if (alive) setBlinkPhase(1) }, 340)
        }
      }, 2000 + Math.random() * 2800)
    }
    next()
    return () => { alive = false }
  }, [])

  // Eye glance
  useEffect(() => {
    let alive = true
    const next = () => {
      if (!alive) return
      setTimeout(() => {
        if (!alive) return
        setLookAt(state !== 'happy'
          ? [(Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 0.8]
          : [0, 0])
        next()
      }, 1600 + Math.random() * 2200)
    }
    next()
    return () => { alive = false }
  }, [state])

  const VB = 200, cx = 100, cy = 108, headR = 70
  const isListening = state === 'listening'
  const isThinking  = state === 'thinking'
  const isHappy     = state === 'happy'
  const isIdle      = state === 'idle'

  const audioVal = audioRef.current
  const jellyW = isIdle ? 1.0 : isListening ? 2.6 : isHappy ? 3.4 : 1.6
  const jelly  = isIdle ? 0.025 : isListening ? 0.05 : isHappy ? 0.06 : 0.035
  const stretchX = 1 + Math.sin(t * jellyW) * jelly + audioVal * 0.035
  const stretchY = 1 + Math.sin(t * jellyW + Math.PI) * jelly + audioVal * 0.025
  const wobble = Math.sin(t * jellyW * 0.6 + 1.3) * (isListening ? 0.018 : 0.01)
  const nodAmount = isListening ? 3.2 : isHappy ? 2.6 : isThinking ? 1.6 : 1.2
  const nodSpeed  = isListening ? 2.4 : isHappy ? 3.6 : isThinking ? 1.4 : 0.9
  const nod  = Math.sin(t * nodSpeed) * nodAmount
  const tilt = (isListening ? Math.sin(t * 1.5) : isIdle ? Math.sin(t * 0.4) : Math.sin(t * 0.9)) * (isListening ? 2.0 : 1.0)

  const eyeY = cy - 6, eyeOffsetX = 18, eyeRX = 9.2, eyeRY = 11
  const ex1 = cx - eyeOffsetX, ex2 = cx + eyeOffsetX
  const lookX = lookAt[0] * 2.4, lookY = lookAt[1] * 1.8
  const mouthCx = cx, mouthY = cy + 20
  const peaks = peaksRef.current

  return (
    <div
      className={className}
      style={{ position: 'relative', width: size, height: size, display: 'inline-block', flexShrink: 0, ...style }}
    >
      {/* Under-glow */}
      <div style={{
        position: 'absolute', inset: '14% 8% 4% 8%', borderRadius: '50%',
        background: color, filter: 'blur(34px)',
        opacity: isListening ? 0.42 + audioVal * 0.25 : isHappy ? 0.28 : isThinking ? 0.22 : 0.14,
        transition: 'opacity .25s', pointerEvents: 'none',
      }} />

      {/* Halo rings */}
      {showHalo && (isListening || isHappy) && [0, 1, 2].map(i => {
        const phase = (t * (isListening ? 0.85 : 0.55) + i * 0.55) % 1.6
        return (
          <div key={i} style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: `1.5px solid ${color}`,
            transform: `scale(${(0.62 + phase * 0.55).toFixed(3)})`,
            opacity: Math.max(0, 0.42 - phase * 0.28),
            pointerEvents: 'none',
          }} />
        )
      })}

      {/* Audio bars ring (listening only) */}
      {showHalo && isListening && (
        <svg viewBox={`0 0 ${VB} ${VB}`} width="100%" height="100%"
          style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
          {Array.from({ length: bars }).map((_, i) => {
            const a = (i / bars) * Math.PI * 2 - Math.PI / 2
            const peak = peaks[i] ?? 0
            const rI = headR + 14, rO = rI + 5 + peak * 22
            return (
              <line key={i}
                x1={cx + Math.cos(a) * rI} y1={cy + Math.sin(a) * rI}
                x2={cx + Math.cos(a) * rO} y2={cy + Math.sin(a) * rO}
                stroke={color} strokeWidth="2.4" strokeLinecap="round"
                opacity={0.35 + peak * 0.55}
              />
            )
          })}
        </svg>
      )}

      {/* Orbiting neural sparkles */}
      {(isListening || isThinking) && (
        <svg viewBox={`0 0 ${VB} ${VB}`} width="100%" height="100%"
          style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
          {Array.from({ length: 5 }).map((_, i) => {
            const a = t * (isThinking ? 0.8 : 1.2) + (i / 5) * Math.PI * 2
            const r = headR + 26 + Math.sin(t * 1.3 + i) * 4
            const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.95
            const sz = 1.6 + (i % 2) * 0.8
            return (
              <g key={i}>
                <circle cx={x} cy={y} r={sz + 2} fill={color} opacity="0.18" />
                <circle cx={x} cy={y} r={sz} fill={color} />
                {i % 2 === 0 && (
                  <g stroke={color} strokeWidth="0.8" strokeLinecap="round" opacity="0.6">
                    <line x1={x - sz * 2} y1={y} x2={x + sz * 2} y2={y} />
                    <line x1={x} y1={y - sz * 2} x2={x} y2={y + sz * 2} />
                  </g>
                )}
              </g>
            )
          })}
        </svg>
      )}

      {/* Head SVG */}
      <svg viewBox={`0 0 ${VB} ${VB}`} width="100%" height="100%" style={{
        position: 'absolute', inset: 0, overflow: 'visible',
        transform: `translateY(${nod.toFixed(2)}px) rotate(${tilt.toFixed(2)}deg)`,
        transformOrigin: '50% 75%',
      }}>
        <defs>
          <radialGradient id="bm-fill" cx="40%" cy="32%" r="78%">
            <stop offset="0%" stopColor="color-mix(in oklch, var(--violet) 6%, var(--surface))" />
            <stop offset="55%" stopColor="var(--surface)" />
            <stop offset="100%" stopColor="color-mix(in oklch, var(--violet) 10%, var(--surface-2))" />
          </radialGradient>
          <radialGradient id="bm-tint" cx="50%" cy="55%" r="65%">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="bm-cheek" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.78 0.15 20)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="oklch(0.78 0.15 20)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g style={{
          transform: `scale(${stretchX.toFixed(3)}, ${stretchY.toFixed(3)}) skewX(${(wobble * 6).toFixed(2)}deg)`,
          transformOrigin: `${cx}px ${cy + 20}px`,
        }}>
          <path d={BRAIN_SHAPE} fill="url(#bm-fill)" stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round" />
          <path d={BRAIN_SHAPE} fill="url(#bm-tint)" opacity={isListening ? 0.85 : 0.55} />
          <ellipse cx={cx - 26} cy={cy + 14} rx={9} ry={6} fill="url(#bm-cheek)" />
          <ellipse cx={cx + 26} cy={cy + 14} rx={9} ry={6} fill="url(#bm-cheek)" />

          {/* Eyes */}
          {[ex1, ex2].map((x, idx) => (
            <g key={idx}>
              {isHappy ? (
                <path
                  d={`M ${x - 7} ${eyeY + 2} Q ${x} ${eyeY - 5} ${x + 7} ${eyeY + 2}`}
                  fill="none" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round"
                />
              ) : (
                <>
                  <ellipse cx={x} cy={eyeY} rx={eyeRX} ry={Math.max(0.6, eyeRY * blinkPhase)}
                    fill="white" stroke="var(--ink)" strokeWidth="1.5" />
                  {blinkPhase > 0.3 && (<>
                    <ellipse cx={x + lookX} cy={eyeY + lookY} rx={4.2}
                      ry={5.4 * Math.min(1, blinkPhase * 1.4)} fill="var(--ink)" />
                    <circle cx={x + lookX + 1.6} cy={eyeY + lookY - 2.4} r={1.6} fill="white" />
                    <circle cx={x + lookX - 1.3} cy={eyeY + lookY + 1.8} r={0.9} fill="white" opacity="0.9" />
                  </>)}
                </>
              )}
            </g>
          ))}

          {/* Mouth */}
          {isListening && (
            <ellipse cx={mouthCx} cy={mouthY}
              rx={3 + audioVal * 2.4} ry={2.2 + audioVal * 2.2}
              fill="var(--ink)" opacity="0.85" />
          )}
          {isHappy && (
            <path d={`M ${mouthCx - 7} ${mouthY - 2} Q ${mouthCx} ${mouthY + 7} ${mouthCx + 7} ${mouthY - 2}`}
              fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" />
          )}
          {isIdle && (
            <path d={`M ${mouthCx - 4} ${mouthY} Q ${mouthCx} ${mouthY + 2.4} ${mouthCx + 4} ${mouthY}`}
              fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
          )}
          {isThinking && (<>
            <path d={`M ${mouthCx - 4} ${mouthY + 1} Q ${mouthCx} ${mouthY - 1.5} ${mouthCx + 4} ${mouthY + 1}`}
              fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
            <circle cx={cx} cy={cy - headR - 4} r="2.4" fill={color}>
              <animate attributeName="opacity" values="0.25;1;0.25" dur="1.4s" repeatCount="indefinite" />
            </circle>
            <circle cx={cx} cy={cy - headR - 4} r="7" fill="none" stroke={color} strokeWidth="0.9" opacity="0.5">
              <animate attributeName="r" values="3;11;3" dur="1.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.6;0;0.6" dur="1.4s" repeatCount="indefinite" />
            </circle>
          </>)}
        </g>
      </svg>
    </div>
  )
}
