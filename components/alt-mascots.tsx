'use client'

import { useEffect, useRef, useState } from 'react'

export type MascotState = 'idle' | 'listening' | 'thinking' | 'happy'

interface MascotProps {
  size?: number
  state?: MascotState
  color?: string
  className?: string
  style?: React.CSSProperties
}

// SSR-safe animation frame hook
function useAnimFrame(): number {
  const [t, setT] = useState(0)
  const startRef = useRef(0)
  useEffect(() => {
    startRef.current = performance.now()
    let raf: number
    const tick = (now: number) => {
      setT((now - startRef.current) / 1000)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return t
}

function useBlink(): number {
  const [open, setOpen] = useState(1)
  useEffect(() => {
    let alive = true
    const next = () => {
      if (!alive) return
      setTimeout(() => {
        if (!alive) return
        setOpen(0)
        setTimeout(() => { if (alive) { setOpen(1); next() } }, 120)
      }, 1800 + Math.random() * 2600)
    }
    next()
    return () => { alive = false }
  }, [])
  return open
}

function useFakeAudio(state: MascotState): number {
  const smoothRef = useRef(0)
  const [val, setVal] = useState(0)
  useEffect(() => {
    let raf: number, last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now
      const target =
        state === 'listening'
          ? Math.max(0, 0.34 + 0.45 * Math.sin(now * 0.012) + 0.22 * Math.sin(now * 0.041 + 1.2) + Math.random() * 0.16 - 0.06)
          : state === 'thinking'
          ? 0.16 + 0.05 * Math.sin(now * 0.005)
          : 0
      smoothRef.current += (target - smoothRef.current) * Math.min(1, dt * 6)
      setVal(smoothRef.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [state])
  return val
}

function KawaiiEye({ cx, cy, rx = 9, ry = 11, open = 1, look = [0, 0] as [number, number] }: {
  cx: number; cy: number; rx?: number; ry?: number; open?: number; look?: [number, number]
}) {
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={rx} ry={Math.max(0.6, ry * open)} fill="white" stroke="var(--ink)" strokeWidth="1.5" />
      {open > 0.3 && (
        <>
          <ellipse cx={cx + look[0]} cy={cy + look[1]} rx={rx * 0.45} ry={ry * 0.5 * Math.min(1, open * 1.4)} fill="var(--ink)" />
          <circle cx={cx + look[0] + 1.5} cy={cy + look[1] - 2.4} r={1.5} fill="white" />
          <circle cx={cx + look[0] - 1.3} cy={cy + look[1] + 1.8} r={0.8} fill="white" opacity={0.85} />
        </>
      )}
    </g>
  )
}

// ── JELLY MASCOT ────────────────────────────────────────────────────────────
export function JellyMascot({ size = 240, state = 'idle', color = 'var(--violet)', className, style }: MascotProps) {
  const t = useAnimFrame()
  const eyeOpen = useBlink()
  const audio = useFakeAudio(state)
  const VB = 200, cx = 100, cy = 100

  const breath = 1 + Math.sin(t * 1.6) * 0.04 + audio * 0.08
  const bounce = Math.sin(t * 1.6) * 3
  const isListening = state === 'listening'
  const lookAt: [number, number] = [Math.sin(t * 0.4) * 1.6, Math.sin(t * 0.5) * 0.8]

  const tentacles: string[] = []
  for (let i = 0; i < 5; i++) {
    const baseX = 70 + (i / 4) * 60
    const phase = i * 0.5 + t * 2.2
    const pts: [number, number][] = []
    for (let s = 0; s <= 8; s++) {
      const y = 130 + (s / 8) * 60
      const wave = Math.sin(phase + s * 0.7) * (6 + audio * 6)
      pts.push([baseX + wave * (s / 8), y])
    }
    let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`
    for (let s = 1; s < pts.length; s++) d += ` L ${pts[s][0].toFixed(2)} ${pts[s][1].toFixed(2)}`
    tentacles.push(d)
  }

  return (
    <div className={className} style={{ position: 'relative', width: size, height: size, display: 'inline-block', flexShrink: 0, ...style }}>
      <div style={{ position: 'absolute', inset: '20% 18% 12% 18%', borderRadius: '50%', background: color, filter: 'blur(34px)', opacity: 0.32 + audio * 0.3, pointerEvents: 'none' }} />
      {isListening && [0, 1, 2].map((i) => {
        const phase = (t * 0.8 + i * 0.55) % 1.6
        return <div key={i} style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `1.5px solid ${color}`, transform: `scale(${(0.55 + phase * 0.5).toFixed(3)})`, opacity: Math.max(0, 0.38 - phase * 0.25), pointerEvents: 'none' }} />
      })}
      <svg viewBox={`0 0 ${VB} ${VB}`} width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <defs>
          <radialGradient id="jelly-grad" cx="50%" cy="35%" r="70%">
            <stop offset="0%" stopColor="color-mix(in oklch, var(--violet) 18%, white)" />
            <stop offset="100%" stopColor="color-mix(in oklch, var(--violet) 35%, var(--surface-2))" />
          </radialGradient>
        </defs>
        <g style={{ transform: `translateY(${bounce.toFixed(2)}px)`, transformOrigin: '50% 70%' }}>
          <g stroke={color} strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.85">
            {tentacles.map((d, i) => <path key={i} d={d} />)}
          </g>
          <g style={{ transform: `scale(${breath.toFixed(3)})`, transformOrigin: `${cx}px ${cy + 10}px` }}>
            <path
              d="M 40 110 C 40 70, 70 50, 100 50 C 130 50, 160 70, 160 110 C 160 124, 145 134, 130 130 C 120 138, 80 138, 70 130 C 55 134, 40 124, 40 110 Z"
              fill="url(#jelly-grad)" stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round"
            />
            <ellipse cx="78" cy="75" rx="14" ry="6" fill="white" opacity="0.45" transform="rotate(-20 78 75)" />
            <ellipse cx={cx - 22} cy={cy + 8} rx="7" ry="4.5" fill="oklch(0.78 0.15 20)" opacity="0.4" />
            <ellipse cx={cx + 22} cy={cy + 8} rx="7" ry="4.5" fill="oklch(0.78 0.15 20)" opacity="0.4" />
            <KawaiiEye cx={cx - 16} cy={cy - 4} look={lookAt} open={eyeOpen} />
            <KawaiiEye cx={cx + 16} cy={cy - 4} look={lookAt} open={eyeOpen} />
            {isListening ? (
              <ellipse cx={cx} cy={cy + 16} rx={Math.max(0.5, 3 + audio * 2.4)} ry={Math.max(0.5, 2 + audio * 2)} fill="var(--ink)" opacity="0.85" />
            ) : state === 'happy' ? (
              <path d={`M ${cx - 6} ${cy + 14} Q ${cx} ${cy + 22} ${cx + 6} ${cy + 14}`} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <path d={`M ${cx - 3} ${cy + 16} Q ${cx} ${cy + 18} ${cx + 3} ${cy + 16}`} fill="none" stroke="var(--ink)" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
            )}
          </g>
        </g>
      </svg>
    </div>
  )
}

// ── CAPSULE MASCOT ──────────────────────────────────────────────────────────
export function CapsuleMascot({ size = 240, state = 'idle', color = 'var(--violet)', className, style }: MascotProps) {
  const t = useAnimFrame()
  const eyeOpen = useBlink()
  const audio = useFakeAudio(state)
  const VB = 200, cx = 100, cy = 110

  const float = Math.sin(t * 1.4) * 6
  const tiltX = Math.sin(t * 0.9) * 3
  const breath = 1 + Math.sin(t * 1.6) * 0.025 + audio * 0.06
  const isListening = state === 'listening'
  const lookAt: [number, number] = [Math.sin(t * 0.4 + 1) * 1.6, Math.sin(t * 0.6) * 0.6]

  return (
    <div className={className} style={{ position: 'relative', width: size, height: size, display: 'inline-block', flexShrink: 0, ...style }}>
      <div style={{ position: 'absolute', inset: '24% 22% 8% 22%', borderRadius: '50%', background: color, filter: 'blur(30px)', opacity: 0.32 + audio * 0.3, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '8%', left: '30%', right: '30%', height: 8, borderRadius: '50%', background: 'rgba(0,0,0,.2)', filter: 'blur(6px)', opacity: Math.max(0, 0.35 - Math.sin(t * 1.4) * 0.1), pointerEvents: 'none' }} />
      <svg viewBox={`0 0 ${VB} ${VB}`} width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <defs>
          <linearGradient id="cap-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="color-mix(in oklch, var(--violet) 8%, white)" />
            <stop offset="100%" stopColor="color-mix(in oklch, var(--violet) 28%, var(--surface-2))" />
          </linearGradient>
        </defs>
        <g style={{ transform: `translate(${tiltX.toFixed(2)}px, ${float.toFixed(2)}px)` }}>
          <line x1={cx} y1="38" x2={cx} y2="20" stroke="var(--ink)" strokeWidth="1.6" />
          <circle cx={cx} cy="14" r={Math.max(1, 4 + audio * 4)} fill={color}>
            <animate attributeName="opacity" values="0.7;1;0.7" dur="1.4s" repeatCount="indefinite" />
          </circle>
          <circle cx={cx} cy="14" r={Math.max(1, 9 + audio * 8)} fill="none" stroke={color} strokeWidth="0.9" opacity={0.4 + audio * 0.4} />
          <g style={{ transform: `scale(${breath.toFixed(3)})`, transformOrigin: `${cx}px ${cy + 20}px` }}>
            <rect x="50" y="60" width="100" height="120" rx="50" fill="url(#cap-grad)" stroke="var(--ink)" strokeWidth="1.6" />
            <rect x="62" y="78" width="76" height="60" rx="22" fill="var(--ink)" opacity="0.1" />
            <KawaiiEye cx={cx - 16} cy={cy - 4} look={lookAt} open={eyeOpen} />
            <KawaiiEye cx={cx + 16} cy={cy - 4} look={lookAt} open={eyeOpen} />
            <ellipse cx={cx - 26} cy={cy + 10} rx="6" ry="4" fill="oklch(0.78 0.15 20)" opacity="0.45" />
            <ellipse cx={cx + 26} cy={cy + 10} rx="6" ry="4" fill="oklch(0.78 0.15 20)" opacity="0.45" />
            {isListening ? (
              <ellipse cx={cx} cy={cy + 18} rx={Math.max(0.5, 3 + audio * 2.5)} ry={Math.max(0.5, 2 + audio * 2.2)} fill="var(--ink)" opacity="0.85" />
            ) : state === 'happy' ? (
              <path d={`M ${cx - 7} ${cy + 16} Q ${cx} ${cy + 24} ${cx + 7} ${cy + 16}`} fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" />
            ) : (
              <path d={`M ${cx - 3} ${cy + 18} Q ${cx} ${cy + 20} ${cx + 3} ${cy + 18}`} fill="none" stroke="var(--ink)" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
            )}
            {isListening && (
              <g transform={`translate(${cx - 18} ${cy + 36})`}>
                {[0, 1, 2, 3, 4, 5].map((i) => {
                  const h = Math.max(2, 3 + Math.abs(Math.sin(t * 4 + i * 0.7)) * (8 + audio * 8))
                  return <rect key={i} x={i * 6} y={10 - h} width="3" height={h} rx="1.5" fill={color} />
                })}
              </g>
            )}
          </g>
        </g>
      </svg>
    </div>
  )
}

// ── CLOUD MASCOT ─────────────────────────────────────────────────────────────
export function CloudMascot({ size = 240, state = 'idle', color = 'var(--violet)', className, style }: MascotProps) {
  const t = useAnimFrame()
  const eyeOpen = useBlink()
  const audio = useFakeAudio(state)
  const VB = 200, cx = 100, cy = 110

  const float = Math.sin(t * 1.1) * 5
  const isListening = state === 'listening'
  const lookAt: [number, number] = [Math.sin(t * 0.4 + 2) * 1.6, Math.sin(t * 0.6) * 0.6]
  const puffs: [number, number, number][] = [
    [44, 116, 26], [70, 86, 32], [104, 78, 36],
    [136, 90, 30], [160, 118, 26], [88, 124, 28], [120, 124, 30],
  ]

  return (
    <div className={className} style={{ position: 'relative', width: size, height: size, display: 'inline-block', flexShrink: 0, ...style }}>
      <div style={{ position: 'absolute', inset: '24% 14% 16% 14%', borderRadius: '50%', background: color, filter: 'blur(34px)', opacity: 0.22 + audio * 0.25, pointerEvents: 'none' }} />
      {state === 'thinking' && (
        <svg viewBox={`0 0 ${VB} ${VB}`} width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
          {[0, 1, 2, 3].map((i) => {
            const phase = (t * 1.6 + i * 0.4) % 1.4
            return <circle key={i} cx={70 + i * 18} cy={140 + phase * 40} r="2.2" fill={color} opacity={Math.max(0, 1 - phase)} />
          })}
        </svg>
      )}
      <svg viewBox={`0 0 ${VB} ${VB}`} width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <defs>
          <radialGradient id="cloud-grad" cx="50%" cy="35%" r="75%">
            <stop offset="0%" stopColor="white" />
            <stop offset="100%" stopColor="color-mix(in oklch, var(--violet) 14%, var(--surface-2))" />
          </radialGradient>
        </defs>
        <g style={{ transform: `translateY(${float.toFixed(2)}px)` }}>
          <g fill="url(#cloud-grad)" stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round">
            {puffs.map(([px, py, pr], i) => {
              const ps = 1 + Math.sin(t * 1.8 + i * 0.8) * 0.06 + audio * 0.08
              return <circle key={i} cx={px} cy={py} r={pr * ps} />
            })}
          </g>
          <g fill="url(#cloud-grad)">
            {puffs.map(([px, py, pr], i) => {
              const ps = 1 + Math.sin(t * 1.8 + i * 0.8) * 0.06 + audio * 0.08
              return <circle key={i} cx={px} cy={py} r={Math.max(0.5, pr * ps - 1.8)} />
            })}
          </g>
          <ellipse cx={cx - 22} cy={cy + 12} rx="7" ry="4" fill="oklch(0.78 0.15 20)" opacity="0.45" />
          <ellipse cx={cx + 22} cy={cy + 12} rx="7" ry="4" fill="oklch(0.78 0.15 20)" opacity="0.45" />
          <KawaiiEye cx={cx - 16} cy={cy} look={lookAt} open={eyeOpen} />
          <KawaiiEye cx={cx + 16} cy={cy} look={lookAt} open={eyeOpen} />
          {isListening ? (
            <ellipse cx={cx} cy={cy + 20} rx={Math.max(0.5, 3 + audio * 2.4)} ry={Math.max(0.5, 2 + audio * 2)} fill="var(--ink)" opacity="0.85" />
          ) : state === 'happy' ? (
            <path d={`M ${cx - 6} ${cy + 18} Q ${cx} ${cy + 26} ${cx + 6} ${cy + 18}`} fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" />
          ) : (
            <path d={`M ${cx - 3} ${cy + 20} Q ${cx} ${cy + 22} ${cx + 3} ${cy + 20}`} fill="none" stroke="var(--ink)" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
          )}
        </g>
      </svg>
    </div>
  )
}

// ── PULSE MASCOT ─────────────────────────────────────────────────────────────
export function PulseMascot({ size = 240, state = 'idle', color = 'var(--violet)', className, style }: MascotProps) {
  const t = useAnimFrame()
  const audio = useFakeAudio(state)
  const VB = 200, cx = 100, cy = 100
  const isListening = state === 'listening'
  const isThinking = state === 'thinking'

  const N = 7
  const nodes = Array.from({ length: N }, (_, i) => {
    const a = (i / N) * Math.PI * 2 + t * (isListening ? 0.32 : isThinking ? 0.2 : 0.12)
    const r = 56 + Math.sin(t * 1.3 + i * 1.7) * 4 + audio * 6
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.92 }
  })

  const W = 24
  const bars = Array.from({ length: W }, (_, i) => {
    const x = 16 + (i / (W - 1)) * (VB - 32)
    const env = Math.sin((i / W) * Math.PI)
    const h = isListening
      ? 2 + (Math.abs(Math.sin(t * 5 + i * 0.6)) * 16 + audio * 22) * env
      : isThinking
      ? 2 + Math.abs(Math.sin(t * 2 + i * 0.5)) * 8 * env
      : 2 + Math.abs(Math.sin(t * 1.2 + i * 0.4)) * 4 * env
    return { x, h }
  })

  const pulses = Array.from({ length: N }, (_, i) => ((t * (isListening ? 0.9 : 0.5) + i / N) % 1))
  const corePulse = 1 + Math.sin(t * 2.2) * 0.08 + audio * 0.25

  return (
    <div className={className} style={{ position: 'relative', width: size, height: size, display: 'inline-block', flexShrink: 0, ...style }}>
      <div style={{ position: 'absolute', inset: '18%', borderRadius: '50%', background: color, filter: 'blur(36px)', opacity: 0.28 + audio * 0.3, pointerEvents: 'none' }} />
      {(isListening || isThinking) && [0, 1, 2].map((i) => {
        const phase = (t * (isListening ? 0.85 : 0.55) + i * 0.55) % 1.6
        return <div key={i} style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `1.4px solid ${color}`, transform: `scale(${(0.6 + phase * 0.55).toFixed(3)})`, opacity: Math.max(0, 0.4 - phase * 0.28), pointerEvents: 'none' }} />
      })}
      <svg viewBox={`0 0 ${VB} ${VB}`} width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <defs>
          <radialGradient id="pulse-core-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="color-mix(in oklch, var(--violet) 8%, white)" />
            <stop offset="100%" stopColor={color} />
          </radialGradient>
        </defs>
        <g>
          {nodes.map((n, i) => (
            <line key={`l-${i}`} x1={cx} y1={cy} x2={n.x} y2={n.y} stroke={color} strokeWidth="1" opacity={0.22 + (isListening ? 0.15 * Math.sin(t * 2 + i) : 0)} />
          ))}
          {(isListening || isThinking) && nodes.map((n, i) => {
            const p = pulses[i]
            return <circle key={`p-${i}`} cx={cx + (n.x - cx) * p} cy={cy + (n.y - cy) * p} r="2" fill={color} opacity={Math.max(0, (1 - p) * 0.9)} />
          })}
        </g>
        <g>
          {nodes.map((n, i) => {
            const beat = isListening ? 1 + Math.sin(t * 4 + i * 1.1) * 0.3 + audio * 0.4 : 1
            return (
              <g key={`n-${i}`}>
                <circle cx={n.x} cy={n.y} r={4 * beat + 3} fill={color} opacity="0.18" />
                <circle cx={n.x} cy={n.y} r={Math.max(0.5, 3 + (isListening ? audio * 1.4 : 0))} fill={color} />
              </g>
            )
          })}
        </g>
        <g style={{ transform: `scale(${corePulse.toFixed(3)})`, transformOrigin: `${cx}px ${cy}px` }}>
          <circle cx={cx} cy={cy} r="18" fill="url(#pulse-core-grad)" stroke={color} strokeWidth="1.4" opacity="0.95" />
          <circle cx={cx - 5} cy={cy - 6} r="5" fill="white" opacity="0.55" />
        </g>
        <g transform={`translate(0 ${VB - 24})`}>
          {bars.map((b, i) => (
            <rect key={i} x={b.x - 1.4} y={10 - b.h / 2} width="2.8" height={b.h} rx="1.4" fill={color} opacity={0.55 + (isListening ? 0.3 : 0)} />
          ))}
        </g>
      </svg>
    </div>
  )
}
