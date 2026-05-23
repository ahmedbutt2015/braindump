'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { BrainMascot } from '@/components/brain-mascot'
import type { BrainMascotState } from '@/components/brain-mascot'
import { JellyMascot, CapsuleMascot, CloudMascot, PulseMascot } from '@/components/alt-mascots'
import type { MascotState } from '@/components/alt-mascots'
import { useSpeechRecognition } from '@/hooks/use-speech-recognition'

type CharId = 'capsule' | 'jelly' | 'cloud' | 'pulse' | 'brain'

const CHARS: { id: CharId; label: string }[] = [
  { id: 'capsule', label: 'Pip'   },
  { id: 'jelly',   label: 'Jelly' },
  { id: 'cloud',   label: 'Wisp'  },
  { id: 'pulse',   label: 'Pulse' },
  { id: 'brain',   label: 'Brain' },
]

const CHAR_KEY = 'bd-voice-char'
const DEFAULT_CHAR: CharId = 'capsule'

interface CaptureZoneProps {
  onSubmit: (content: string) => void
  isProcessing: boolean
}

function CharacterDisplay({ id, state, size }: { id: CharId; state: MascotState; size: number }) {
  switch (id) {
    case 'jelly':   return <JellyMascot   size={size} state={state} color="var(--violet)" />
    case 'capsule': return <CapsuleMascot size={size} state={state} color="var(--violet)" />
    case 'cloud':   return <CloudMascot   size={size} state={state} color="var(--violet)" />
    case 'pulse':   return <PulseMascot   size={size} state={state} color="var(--violet)" />
    case 'brain':   return <BrainMascot   size={size} state={state as BrainMascotState} />
  }
}

export function CaptureZone({ onSubmit, isProcessing }: CaptureZoneProps) {
  const [char, setChar] = useState<CharId>(DEFAULT_CHAR)
  const [isFallback, setIsFallback] = useState(false)
  const [isFallbackRecording, setIsFallbackRecording] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState('')
  const [textInput, setTextInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isHappy, setIsHappy] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const accumulatedRef = useRef('')
  const happyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevProcessingRef = useRef(false)

  // Load saved character
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CHAR_KEY) as CharId | null
      if (saved && CHARS.some(c => c.id === saved)) setChar(saved)
    } catch { /* ignore */ }
  }, [])

  // Show happy face when processing completes
  useEffect(() => {
    if (prevProcessingRef.current && !isProcessing) {
      if (happyTimerRef.current) clearTimeout(happyTimerRef.current)
      setIsHappy(true)
      happyTimerRef.current = setTimeout(() => setIsHappy(false), 2200)
    }
    prevProcessingRef.current = isProcessing
  }, [isProcessing])

  useEffect(() => {
    return () => { if (happyTimerRef.current) clearTimeout(happyTimerRef.current) }
  }, [])

  const saveChar = (id: CharId) => {
    setChar(id)
    try { localStorage.setItem(CHAR_KEY, id) } catch { /* ignore */ }
  }

  const doSubmit = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setLiveTranscript('')
    accumulatedRef.current = ''
    onSubmit(trimmed)
  }, [onSubmit])

  const {
    isListening,
    interimTranscript,
    startListening,
    stopListening,
  } = useSpeechRecognition({
    continuous: true,
    interimResults: true,
    onResult: (text) => {
      accumulatedRef.current += (accumulatedRef.current ? ' ' : '') + text
      setLiveTranscript(accumulatedRef.current)
    },
    onError: (err) => {
      if (err.includes('not supported') || err.includes('denied') || err.includes('not-allowed')) {
        setIsFallback(true)
      }
      setError(err)
    },
  })

  const startFallbackRecording = useCallback(async () => {
    try {
      setError(null)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const mr = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mr
      audioChunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setIsFallbackRecording(false)
        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        try {
          const fd = new FormData()
          fd.append('audio', blob)
          const res = await fetch('/api/transcribe', { method: 'POST', body: fd })
          const data = await res.json()
          if (res.ok && data.transcript) {
            doSubmit(data.transcript)
          } else if (data.modelLoading) {
            setError(`AI warming up — try again in ~${data.retryAfter ?? 20}s`)
          } else {
            setError(data.error || 'Transcription failed')
          }
        } catch {
          setError('Failed to transcribe. Check your connection.')
        }
      }
      mr.start()
      setIsFallbackRecording(true)
    } catch {
      setError('Microphone access denied.')
    }
  }, [doSubmit])

  const stopFallbackRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current?.stop()
    }
  }, [])

  const handleToggle = useCallback(() => {
    setError(null)
    const active = isListening || isFallbackRecording

    if (active) {
      if (isFallback || isFallbackRecording) {
        stopFallbackRecording()
      } else {
        const text = accumulatedRef.current
        stopListening()
        accumulatedRef.current = ''
        setLiveTranscript('')
        if (text.trim()) doSubmit(text)
      }
    } else {
      accumulatedRef.current = ''
      setLiveTranscript('')
      if (isFallback) {
        startFallbackRecording()
      } else {
        const started = startListening()
        if (!started) {
          setIsFallback(true)
          startFallbackRecording()
        }
      }
    }
  }, [isListening, isFallbackRecording, isFallback, stopListening, stopFallbackRecording, startListening, startFallbackRecording, doSubmit])

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!textInput.trim() || isProcessing) return
    const text = textInput
    setTextInput('')
    doSubmit(text)
  }

  const activeRecording = isListening || isFallbackRecording
  const mascotState: MascotState = isProcessing
    ? 'thinking'
    : isHappy
    ? 'happy'
    : activeRecording
    ? 'listening'
    : 'idle'

  const displayText = liveTranscript + (interimTranscript ? (liveTranscript ? ' ' : '') + interimTranscript : '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, padding: '8px 0 20px' }}>

      {/* Big clickable character */}
      <div
        role="button"
        tabIndex={0}
        aria-label={activeRecording ? 'Stop recording' : 'Start voice recording'}
        onClick={isProcessing ? undefined : handleToggle}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !isProcessing) {
            e.preventDefault()
            handleToggle()
          }
        }}
        style={{
          position: 'relative',
          cursor: isProcessing ? 'wait' : 'pointer',
          borderRadius: '50%',
          outline: 'none',
          userSelect: 'none',
        }}
      >
        {/* Pulsing ring while recording */}
        {activeRecording && (
          <div style={{
            position: 'absolute',
            inset: -16,
            borderRadius: '50%',
            border: '2px solid var(--violet)',
            opacity: 0.4,
            animation: 'orb-ring 1.8s ease-out infinite',
            pointerEvents: 'none',
          }} />
        )}
        <CharacterDisplay id={char} state={mascotState} size={280} />
      </div>

      {/* Status */}
      <div style={{ textAlign: 'center', minHeight: 40 }}>
        {isProcessing ? (
          <p style={{ fontSize: 14, color: 'var(--violet)', fontWeight: 500, margin: 0 }}>
            Extracting tasks from your thoughts…
          </p>
        ) : activeRecording ? (
          <>
            <p style={{ fontSize: 14, color: 'var(--violet)', fontWeight: 500, margin: 0 }}>
              {isFallbackRecording ? 'Recording…' : 'Listening…'}
              <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted-foreground)', fontWeight: 400 }}>
                click to stop &amp; extract
              </span>
            </p>
            {displayText && (
              <p style={{
                fontSize: 13, color: 'var(--ink)', lineHeight: 1.5,
                maxWidth: 420, margin: '6px auto 0',
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>
                &ldquo;{displayText}&rdquo;
              </p>
            )}
          </>
        ) : error ? (
          <p style={{ fontSize: 13, color: 'var(--destructive)', margin: 0 }}>{error}</p>
        ) : (
          <p style={{ fontSize: 14, color: 'var(--muted-foreground)', margin: 0 }}>
            Click to start — talk freely, I&apos;ll extract your tasks
          </p>
        )}
      </div>

      {/* Character picker */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {CHARS.map((c) => (
          <button
            key={c.id}
            type="button"
            title={c.label}
            onClick={() => saveChar(c.id)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '5px 7px', borderRadius: 'var(--r-sm)',
              border: char === c.id ? '1.5px solid var(--violet)' : '1.5px solid var(--line)',
              background: char === c.id
                ? 'color-mix(in oklch, var(--violet) 10%, var(--surface))'
                : 'var(--surface)',
              cursor: 'pointer',
              transition: 'border-color 0.12s, background 0.12s',
            }}
          >
            <div style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CharacterDisplay
                id={c.id}
                state={char === c.id ? mascotState : 'idle'}
                size={44}
              />
            </div>
            <span style={{
              fontSize: 9, fontFamily: 'var(--mono)', letterSpacing: '0.06em',
              color: char === c.id ? 'var(--violet)' : 'var(--muted-foreground)',
              lineHeight: 1,
            }}>
              {c.label.toUpperCase()}
            </span>
          </button>
        ))}
      </div>

      {/* Text input */}
      <form onSubmit={handleTextSubmit} style={{ width: '100%', maxWidth: 500 }}>
        <div style={{ position: 'relative' }}>
          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="or type your thoughts here…"
            disabled={isProcessing}
            rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleTextSubmit(e as unknown as React.FormEvent)
              }
            }}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '11px 14px 11px 14px',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              fontSize: 14, lineHeight: 1.6,
              resize: 'vertical', minHeight: 80,
              fontFamily: 'var(--body)',
              outline: 'none',
              transition: 'border-color 0.12s',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--violet)' }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line)' }}
          />
          {textInput.trim() && (
            <button
              type="submit"
              disabled={isProcessing}
              style={{
                position: 'absolute', bottom: 9, right: 9,
                height: 30, padding: '0 12px',
                borderRadius: 'var(--r-sm)',
                background: 'var(--violet)', color: 'white',
                border: 'none', cursor: isProcessing ? 'not-allowed' : 'pointer',
                fontSize: 12, fontWeight: 500,
                opacity: isProcessing ? 0.5 : 1,
              }}
            >
              Extract →
            </button>
          )}
        </div>
        <div className="t-mono" style={{ color: 'var(--muted-foreground)', marginTop: 5, textAlign: 'right', fontSize: 10 }}>
          ⌘ + Enter to submit
        </div>
      </form>
    </div>
  )
}
