'use client'

import { useState, useRef, useCallback, useEffect, type FormEvent } from 'react'
import { BrainMascot } from '@/components/brain-mascot'
import type { BrainMascotState } from '@/components/brain-mascot'
import { JellyMascot, CapsuleMascot, CloudMascot, PulseMascot } from '@/components/alt-mascots'
import type { MascotState } from '@/components/alt-mascots'
import { useSpeechRecognition } from '@/hooks/use-speech-recognition'
import { useIsMobile } from '@/hooks/use-mobile'

type CharId = 'capsule' | 'jelly' | 'cloud' | 'pulse' | 'brain'

const CHARS: { id: CharId; label: string }[] = [
  { id: 'capsule', label: 'Pip' },
  { id: 'jelly', label: 'Jelly' },
  { id: 'cloud', label: 'Wisp' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'brain', label: 'Brain' },
]

const CHAR_KEY = 'bd-voice-char'
const DEFAULT_CHAR: CharId = 'capsule'

export interface CaptureSubmitResult {
  transcript: string
  summary: string
  tasksExtracted: number
  enrichmentsApplied: number
  extractedTasks: Array<{
    title: string
    description: string | null
    priority: 'low' | 'medium' | 'high'
    due_date: string | null
  }>
}

interface CaptureZoneProps {
  onSubmit: (content: string) => Promise<CaptureSubmitResult | null>
  isProcessing: boolean
  userLabel: string
  userInitial: string
  todayLabel: string
  dailyBrief: string
}

function CharacterDisplay({ id, state, size }: { id: CharId; state: MascotState; size: number }) {
  switch (id) {
    case 'jelly':
      return <JellyMascot size={size} state={state} color="var(--violet)" />
    case 'capsule':
      return <CapsuleMascot size={size} state={state} color="var(--violet)" />
    case 'cloud':
      return <CloudMascot size={size} state={state} color="var(--violet)" />
    case 'pulse':
      return <PulseMascot size={size} state={state} color="var(--violet)" />
    case 'brain':
      return <BrainMascot size={size} state={state as BrainMascotState} />
  }
}

export function CaptureZone({
  onSubmit,
  isProcessing,
  userLabel,
  userInitial,
  todayLabel,
  dailyBrief,
}: CaptureZoneProps) {
  const isMobile = useIsMobile()
  const [char, setChar] = useState<CharId>(DEFAULT_CHAR)
  const [showPicker, setShowPicker] = useState(false)
  const [isFallback, setIsFallback] = useState(false)
  const [isFallbackRecording, setIsFallbackRecording] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState('')
  const [textInput, setTextInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isHappy, setIsHappy] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [mobileStage, setMobileStage] = useState<'idle' | 'recording' | 'result'>('idle')
  const [lastResult, setLastResult] = useState<CaptureSubmitResult | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const accumulatedRef = useRef('')
  const cancelFallbackRef = useRef(false)
  const happyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevProcessingRef = useRef(false)
  const startTimeRef = useRef<number | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CHAR_KEY) as CharId | null
      if (saved && CHARS.some(c => c.id === saved)) setChar(saved)
    } catch {
      // ignore storage failures
    }
  }, [])

  useEffect(() => {
    if (prevProcessingRef.current && !isProcessing) {
      if (happyTimerRef.current) clearTimeout(happyTimerRef.current)
      setIsHappy(true)
      happyTimerRef.current = setTimeout(() => setIsHappy(false), 2200)
    }

    if (isMobile) {
      if (isProcessing) {
        setMobileStage('recording')
      } else if (prevProcessingRef.current && !isProcessing && lastResult) {
        setMobileStage('result')
      }
    }

    prevProcessingRef.current = isProcessing
  }, [isMobile, isProcessing, lastResult])

  useEffect(() => {
    return () => {
      if (happyTimerRef.current) clearTimeout(happyTimerRef.current)
    }
  }, [])

  const {
    isListening,
    interimTranscript,
    startListening,
    stopListening,
  } = useSpeechRecognition({
    continuous: true,
    interimResults: true,
    onResult: (text) => {
      accumulatedRef.current += `${accumulatedRef.current ? ' ' : ''}${text}`
      setLiveTranscript(accumulatedRef.current)
    },
    onError: (message) => {
      if (message.includes('not supported') || message.includes('denied') || message.includes('not-allowed')) {
        setIsFallback(true)
      }
      setError(message)
    },
  })

  const activeRecording = isListening || isFallbackRecording
  const displayText = [liveTranscript, interimTranscript].filter(Boolean).join(' ').trim()

  useEffect(() => {
    if (!activeRecording) {
      startTimeRef.current = null
      setElapsedSeconds(0)
      return
    }

    if (startTimeRef.current == null) {
      startTimeRef.current = Date.now()
    }

    const timer = window.setInterval(() => {
      if (startTimeRef.current != null) {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }
    }, 250)

    return () => window.clearInterval(timer)
  }, [activeRecording])

  const saveChar = (id: CharId) => {
    setChar(id)
    try {
      localStorage.setItem(CHAR_KEY, id)
    } catch {
      // ignore storage failures
    }
  }

  const resetCaptureState = useCallback(() => {
    accumulatedRef.current = ''
    setLiveTranscript('')
    setIsPaused(false)
    setError(null)
  }, [])

  const doSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    const result = await onSubmit(trimmed)
    if (result) {
      setLastResult(result)
      if (isMobile) setMobileStage('result')
    }
  }, [isMobile, onSubmit])

  const startFallbackRecording = useCallback(async () => {
    try {
      setError(null)
      cancelFallbackRef.current = false
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop())
        setIsFallbackRecording(false)

        if (cancelFallbackRef.current) {
          cancelFallbackRef.current = false
          return
        }

        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        try {
          const formData = new FormData()
          formData.append('audio', blob)
          const response = await fetch('/api/transcribe', { method: 'POST', body: formData })
          const data = await response.json()

          if (response.ok && data.transcript) {
            accumulatedRef.current = data.transcript
            setLiveTranscript(data.transcript)
            await doSubmit(data.transcript)
          } else if (data.modelLoading) {
            setError(`AI warming up — try again in ~${data.retryAfter ?? 20}s`)
          } else {
            setError(data.error || 'Transcription failed')
          }
        } catch {
          setError('Failed to transcribe. Check your connection.')
        }
      }

      recorder.start()
      setIsFallbackRecording(true)
    } catch {
      setError('Microphone access denied.')
    }
  }, [doSubmit])

  const stopFallbackRecording = useCallback((cancel = false) => {
    cancelFallbackRef.current = cancel
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
  }, [])

  const beginCapture = useCallback((resume = false) => {
    setError(null)
    setLastResult(null)
    if (!resume) {
      accumulatedRef.current = ''
      setLiveTranscript('')
      setElapsedSeconds(0)
      startTimeRef.current = null
    }
    setIsPaused(false)
    if (isMobile) setMobileStage('recording')

    if (isFallback) {
      void startFallbackRecording()
      return
    }

    const started = startListening()
    if (!started) {
      setIsFallback(true)
      void startFallbackRecording()
    }
  }, [isFallback, isMobile, startFallbackRecording, startListening])

  const pauseCapture = useCallback(() => {
    if (isFallbackRecording) return
    stopListening()
    setIsPaused(true)
  }, [isFallbackRecording, stopListening])

  const cancelCapture = useCallback(() => {
    if (isFallbackRecording) {
      stopFallbackRecording(true)
    } else if (isListening) {
      stopListening()
    }
    resetCaptureState()
    if (isMobile) setMobileStage('idle')
  }, [isFallbackRecording, isListening, isMobile, resetCaptureState, stopFallbackRecording, stopListening])

  const stopAndExtract = useCallback(async () => {
    const transcript = displayText

    if (isFallbackRecording) {
      stopFallbackRecording(false)
      return
    }

    if (isListening) stopListening()
    setIsPaused(false)

    if (transcript) {
      accumulatedRef.current = transcript
      setLiveTranscript(transcript)
      await doSubmit(transcript)
    } else {
      setError('Say a little more and try again.')
      if (isMobile) setMobileStage('idle')
    }
  }, [displayText, doSubmit, isFallbackRecording, isListening, isMobile, stopFallbackRecording, stopListening])

  const handleTextSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!textInput.trim() || isProcessing) return
    const text = textInput
    setTextInput('')
    await doSubmit(text)
  }

  const mascotState: MascotState = isProcessing
    ? 'thinking'
    : isHappy
      ? 'happy'
      : activeRecording
        ? 'listening'
        : isPaused
          ? 'thinking'
          : 'idle'

  if (isMobile) {
    return (
      <>
        <MobileIdleCard
          active={mobileStage === 'idle' && !activeRecording && !isProcessing}
          todayLabel={todayLabel}
          userLabel={userLabel}
          userInitial={userInitial}
          brief={dailyBrief}
          char={char}
          mascotState={mascotState}
          showPicker={showPicker}
          setShowPicker={setShowPicker}
          saveChar={saveChar}
          onStart={() => beginCapture(false)}
          textInput={textInput}
          setTextInput={setTextInput}
          isProcessing={isProcessing}
          onTextSubmit={handleTextSubmit}
        />

        {(mobileStage === 'recording' || isProcessing || activeRecording || isPaused) && (
          <MobileRecordingOverlay
            char={char}
            mascotState={mascotState}
            transcript={displayText}
            elapsedSeconds={elapsedSeconds}
            isPaused={isPaused}
            isProcessing={isProcessing}
            onPause={pauseCapture}
            onResume={() => beginCapture(true)}
            onCancel={cancelCapture}
            onStop={stopAndExtract}
            previewCards={buildPreviewCards(displayText)}
          />
        )}

        {mobileStage === 'result' && lastResult && !isProcessing && (
          <MobileResultOverlay
            result={lastResult}
            char={char}
            onBack={() => setMobileStage('idle')}
            onEdit={() => {
              setTextInput(lastResult.transcript)
              setMobileStage('idle')
            }}
            onDone={() => setMobileStage('idle')}
          />
        )}
      </>
    )
  }

  if (activeRecording || isProcessing || isPaused) {
    return (
      <div className="card" style={{ position: 'relative', overflow: 'hidden', minHeight: 560 }}>
        <div className="neural-bg" />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, padding: '36px 24px 32px' }}>
          <div style={{ alignSelf: 'stretch', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div className="t-eyebrow">{isProcessing ? 'Thinking' : isPaused ? 'Paused' : `Listening · ${formatElapsed(elapsedSeconds)}`}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginTop: 4 }}>
                {isProcessing ? 'Sorting and linking your dump' : 'Desktop capture'}
              </div>
            </div>
            <button type="button" className="btn sm ghost" onClick={() => setShowPicker(s => !s)}>
              Characters
            </button>
          </div>

          {showPicker && (
            <div style={{ alignSelf: 'stretch' }}>
              <CharacterPicker char={char} mascotState={mascotState} saveChar={saveChar} />
            </div>
          )}

          <CharacterDisplay id={char} state={mascotState} size={300} />

          <div style={{ textAlign: 'center', maxWidth: 560 }}>
            <div className="t-h2" style={{ marginTop: 6, textWrap: 'pretty', fontSize: 28 }}>
              {displayText
                ? `"...${displayText.slice(0, 140)}${displayText.length > 140 ? '…' : ''}"`
                : isProcessing
                  ? 'Pulling tasks, due dates, and links from what you just said.'
                  : 'Keep going. I’ll pull tasks and context as you talk.'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            {buildPreviewCards(displayText).map((card, index) => (
              <div
                key={`${card.title}-${index}`}
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--r-pill)',
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  boxShadow: 'var(--shadow-2)',
                  fontSize: 13,
                  animation: `float-slow ${2.4 + index * 0.4}s ease-in-out infinite`,
                }}
              >
                <span className="chip dot" style={{ color: priorityColor(card.priority) }}>{card.priority}</span>
                <span style={{ color: 'var(--ink)' }}>{card.title}</span>
                <span className="t-mono" style={{ color: card.badge === 'NEW' ? 'var(--violet)' : 'var(--cyan)' }}>{card.badge}</span>
              </div>
            ))}
          </div>

          {error && <div style={{ fontSize: 13, color: 'var(--high)' }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            {isPaused ? (
              <button type="button" className="btn" onClick={() => beginCapture(true)}>Resume</button>
            ) : (
              <button type="button" className="btn" onClick={pauseCapture} disabled={isProcessing || isFallbackRecording}>
                Pause
              </button>
            )}
            <button type="button" className="btn primary" onClick={() => void stopAndExtract()} disabled={isProcessing}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect width="12" height="12" rx="2" /></svg>
              Stop &amp; extract
            </button>
            <button type="button" className="btn ghost" onClick={cancelCapture}>Cancel</button>
          </div>
          <div className="t-mono" style={{ color: 'var(--copy-muted)' }}>HOLD ⌘ ␣ ANYWHERE TO DUMP</div>
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, minWidth: 0, flex: 1 }}>
          <CharacterDisplay id={char} state={mascotState} size={118} />
          <div style={{ minWidth: 0 }}>
            <div className="t-eyebrow">Quick capture</div>
            <div className="t-h3" style={{ marginTop: 6, fontSize: 22 }}>Dump it before it disappears.</div>
            <div className="t-body" style={{ marginTop: 6, maxWidth: 560 }}>
              Start a voice dump, switch mascots, or type a thought and let BrainDump turn it into linked tasks.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button type="button" className="btn violet" onClick={() => beginCapture(false)}>
                Start voice
              </button>
              <button type="button" className="btn" onClick={() => setShowPicker(s => !s)}>
                Choose character
              </button>
            </div>
          </div>
        </div>
        <div className="t-mono" style={{ color: 'var(--copy-muted)' }}>HOLD ⌘ ␣ ANYWHERE TO DUMP</div>
      </div>

      {showPicker && (
        <div style={{ marginTop: 16 }}>
          <CharacterPicker char={char} mascotState={mascotState} saveChar={saveChar} />
        </div>
      )}

      <form onSubmit={handleTextSubmit} style={{ marginTop: 16 }}>
        <div style={{ position: 'relative' }}>
          <textarea
            value={textInput}
            onChange={(event) => setTextInput(event.target.value)}
            placeholder="or type your thoughts here..."
            disabled={isProcessing}
            rows={3}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void handleTextSubmit(event)
              }
            }}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '11px 14px 11px 14px',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              fontSize: 14,
              lineHeight: 1.6,
              resize: 'vertical',
              minHeight: 88,
              fontFamily: 'var(--body)',
              outline: 'none',
            }}
          />
          {textInput.trim() && (
            <button
              type="submit"
              disabled={isProcessing}
              className="btn violet sm"
              style={{ position: 'absolute', bottom: 10, right: 10 }}
            >
              Extract
            </button>
          )}
        </div>
        <div className="t-mono" style={{ color: 'var(--copy-muted)', marginTop: 6, textAlign: 'right', fontSize: 10 }}>
          ⌘ + Enter to submit
        </div>
      </form>
    </div>
  )
}

function CharacterPicker({
  char,
  mascotState,
  saveChar,
}: {
  char: CharId
  mascotState: MascotState
  saveChar: (id: CharId) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {CHARS.map(option => (
        <button
          key={option.id}
          type="button"
          title={option.label}
          onClick={() => saveChar(option.id)}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            padding: '7px 8px',
            borderRadius: 'var(--r-sm)',
            border: char === option.id ? '1.5px solid var(--violet)' : '1.5px solid var(--line)',
            background: char === option.id
              ? 'color-mix(in oklch, var(--violet) 10%, var(--surface))'
              : 'var(--surface)',
            cursor: 'pointer',
          }}
        >
          <div style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CharacterDisplay id={option.id} state={char === option.id ? mascotState : 'idle'} size={44} />
          </div>
          <span style={{
            fontSize: 9,
            fontFamily: 'var(--mono)',
            letterSpacing: '0.06em',
            color: char === option.id ? 'var(--violet)' : 'var(--copy-muted)',
            lineHeight: 1,
          }}>
            {option.label.toUpperCase()}
          </span>
        </button>
      ))}
    </div>
  )
}

function MobileIdleCard({
  active,
  todayLabel,
  userLabel,
  userInitial,
  brief,
  char,
  mascotState,
  showPicker,
  setShowPicker,
  saveChar,
  onStart,
  textInput,
  setTextInput,
  isProcessing,
  onTextSubmit,
}: {
  active: boolean
  todayLabel: string
  userLabel: string
  userInitial: string
  brief: string
  char: CharId
  mascotState: MascotState
  showPicker: boolean
  setShowPicker: (value: boolean | ((current: boolean) => boolean)) => void
  saveChar: (id: CharId) => void
  onStart: () => void
  textInput: string
  setTextInput: (value: string) => void
  isProcessing: boolean
  onTextSubmit: (event: FormEvent) => Promise<void>
}) {
  return (
    <div
      style={{
        display: active ? 'flex' : 'none',
        flexDirection: 'column',
        gap: 12,
        padding: '0 0 12px',
      }}
    >
      <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14, fontWeight: 600, color: 'var(--ink)', padding: '0 4px' }}>
        <span>9:42</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="t-mono" style={{ color: 'var(--copy-muted)', fontSize: 11 }}>{todayLabel}</span>
          <div className="avatar">{userInitial}</div>
        </div>
      </div>

      <div style={{ paddingTop: 4 }}>
        <div className="t-eyebrow">Good morning, {userLabel}</div>
        <div className="t-h2" style={{ fontSize: 28, marginTop: 4 }}>What&apos;s on your mind?</div>
      </div>

      <div className="card" style={{
        padding: 14,
        background: 'linear-gradient(135deg, color-mix(in oklch, var(--violet) 8%, var(--surface)) 0%, var(--surface) 70%)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="chip dot" style={{ color: 'var(--violet)' }}>daily brief</span>
          <span className="t-mono" style={{ color: 'var(--copy-muted)' }}>3 things</span>
        </div>
        <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.5, color: 'var(--ink)' }}>{brief}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '10px 0 0' }}>
        <CharacterDisplay id={char} state={mascotState} size={220} />
        <div style={{ marginTop: 18, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--ink)' }}>Hold to dump</div>
          <div className="t-small" style={{ marginTop: 2 }}>I&apos;ll listen, sort, and link.</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 4 }}>
        <button
          type="button"
          onClick={onStart}
          style={{
            width: 96,
            height: 96,
            borderRadius: 999,
            background: 'var(--violet)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            boxShadow: '0 14px 30px color-mix(in oklch, var(--violet) 40%, transparent), 0 0 0 8px color-mix(in oklch, var(--violet) 10%, transparent)',
            border: 'none',
          }}
        >
          <svg width="32" height="36" viewBox="0 0 32 36" fill="none">
            <rect x="10" y="2" width="12" height="20" rx="6" fill="white" />
            <path d="M5 18a11 11 0 0 0 22 0M16 29v5M11 34h10" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </div>
      <div className="t-mono" style={{ textAlign: 'center', color: 'var(--copy-muted)' }}>HOLD · or tap to type</div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
        <button type="button" className="btn sm ghost" onClick={() => setShowPicker(current => !current)}>
          Change character
        </button>
      </div>

      {showPicker && <CharacterPicker char={char} mascotState={mascotState} saveChar={saveChar} />}

      <form onSubmit={(event) => void onTextSubmit(event)}>
        <div style={{ position: 'relative' }}>
          <textarea
            value={textInput}
            onChange={(event) => setTextInput(event.target.value)}
            placeholder="or type your thoughts here..."
            disabled={isProcessing}
            rows={3}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '11px 14px',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              fontSize: 14,
              lineHeight: 1.6,
              resize: 'vertical',
              minHeight: 92,
              fontFamily: 'var(--body)',
              outline: 'none',
            }}
          />
          {textInput.trim() && (
            <button
              type="submit"
              disabled={isProcessing}
              className="btn violet sm"
              style={{ position: 'absolute', bottom: 10, right: 10 }}
            >
              Extract
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

function MobileRecordingOverlay({
  char,
  mascotState,
  transcript,
  elapsedSeconds,
  isPaused,
  isProcessing,
  onPause,
  onResume,
  onCancel,
  onStop,
  previewCards,
}: {
  char: CharId
  mascotState: MascotState
  transcript: string
  elapsedSeconds: number
  isPaused: boolean
  isProcessing: boolean
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onStop: () => void
  previewCards: ReturnType<typeof buildPreviewCards>
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--bg-tint)', padding: '18px 20px 14px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
        <span>9:42</span>
        <span className="t-mono" style={{ color: 'var(--copy-muted)', fontSize: 11 }}>SLIDE UP TO CANCEL</span>
      </div>

      <div style={{ paddingTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--violet)', boxShadow: '0 0 0 4px color-mix(in oklch, var(--violet) 20%, transparent)' }} />
          <span className="t-mono" style={{ color: 'var(--violet)' }}>
            {isProcessing ? 'THINKING' : isPaused ? 'PAUSED' : `LISTENING · ${formatElapsed(elapsedSeconds)}`}
          </span>
        </div>
        <button type="button" className="btn sm ghost" onClick={onCancel}>Cancel</button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <CharacterDisplay id={char} state={mascotState} size={260} />
        <div style={{ marginTop: 30, padding: '0 8px', textAlign: 'center' }}>
          <div style={{ fontSize: 18, color: 'var(--ink)', lineHeight: 1.45, fontWeight: 500 }}>
            {transcript
              ? `"${transcript.slice(0, 180)}${transcript.length > 180 ? '…' : ''}"`
              : isProcessing
                ? 'Sorting what you said into tasks and context...'
                : 'I’m listening.'}
          </div>
        </div>
      </div>

      <div style={{ padding: '0 0 18px' }}>
        <div className="t-mono" style={{ color: 'var(--copy-muted)', marginBottom: 8 }}>EXTRACTING</div>
        <div style={{
          padding: 12,
          borderRadius: 'var(--r-md)',
          border: '1px dashed color-mix(in oklch, var(--violet) 40%, var(--line))',
          background: 'color-mix(in oklch, var(--violet) 4%, var(--surface))',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          {previewCards.slice(0, 2).map((card, index) => (
            <div key={`${card.title}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: priorityColor(card.priority) }} />
              <span style={{ fontSize: 13, color: 'var(--ink)' }}>{card.title}</span>
              <span
                className={card.badge === '+context' ? 'chip' : 't-mono'}
                style={card.badge === '+context'
                  ? {
                      marginLeft: 'auto',
                      background: 'color-mix(in oklch, var(--cyan) 14%, transparent)',
                      borderColor: 'transparent',
                      color: 'var(--ink-2)',
                    }
                  : { marginLeft: 'auto', color: 'var(--violet)' }}
              >
                {card.badge}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 16 }}>
        <button
          type="button"
          onClick={onStop}
          disabled={isProcessing}
          style={{
            width: 96,
            height: 96,
            borderRadius: 999,
            background: 'var(--ink)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            boxShadow: '0 14px 30px rgba(0,0,0,.35), 0 0 0 12px color-mix(in oklch, var(--ink) 6%, transparent)',
            border: 'none',
            position: 'relative',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="white"><rect x="3" y="3" width="16" height="16" rx="3" /></svg>
          <div style={{
            position: 'absolute',
            inset: -14,
            borderRadius: 999,
            border: '1.5px solid var(--violet)',
            opacity: 0.55,
            animation: 'orb-ring 1.6s ease-out infinite',
          }} />
        </button>
      </div>
      <div className="t-mono" style={{ textAlign: 'center', color: 'var(--copy-muted)', paddingBottom: 12 }}>
        RELEASE TO SEND
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, paddingBottom: 8 }}>
        {isPaused ? (
          <button type="button" className="btn sm" onClick={onResume}>Resume</button>
        ) : (
          <button type="button" className="btn sm" onClick={onPause} disabled={isProcessing}>Pause</button>
        )}
        <button type="button" className="btn sm ghost" onClick={onCancel}>Back</button>
      </div>
    </div>
  )
}

function MobileResultOverlay({
  result,
  char,
  onBack,
  onEdit,
  onDone,
}: {
  result: CaptureSubmitResult
  char: CharId
  onBack: () => void
  onEdit: () => void
  onDone: () => void
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--bg)', padding: '18px 18px 14px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
        <span>9:42</span>
        <span className="t-mono" style={{ color: 'var(--copy-muted)', fontSize: 11 }}>JUST NOW · VOICE</span>
      </div>

      <div style={{ paddingTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button type="button" className="btn ghost sm" onClick={onBack}>back</button>
      </div>

      <div style={{ padding: '14px 4px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CharacterDisplay id={char} state="happy" size={56} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>Got it.</div>
            <div className="t-small">
              {result.tasksExtracted} task{result.tasksExtracted === 1 ? '' : 's'} · {result.enrichmentsApplied} enrichment{result.enrichmentsApplied === 1 ? '' : 's'}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '18px 0 0', display: 'flex', flexDirection: 'column', gap: 10, flex: 1, overflowY: 'auto' }}>
        <div className="card" style={{ padding: 12, background: 'var(--surface-2)' }}>
          <div className="t-mono" style={{ color: 'var(--copy-muted)', marginBottom: 6 }}>TRANSCRIPT</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
            {result.transcript}
          </div>
        </div>

        {result.extractedTasks.length > 0 ? result.extractedTasks.map(task => (
          <div key={task.title} className="card" style={{ padding: 12, display: 'flex', gap: 10 }}>
            <div style={{ width: 18, height: 18, borderRadius: 5, border: '1.5px solid var(--line-strong)', flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{task.title}</span>
                <span className="chip dot" style={{ color: priorityColor(task.priority) as string, marginLeft: 'auto' }}>{task.priority === 'medium' ? 'med' : task.priority}</span>
              </div>
              <div className="t-small" style={{ marginTop: 2 }}>
                {task.description ? <><span style={{ color: 'var(--violet)' }}>↳ </span>{task.description}</> : 'new task'}
              </div>
            </div>
          </div>
        )) : (
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>No brand-new tasks</div>
            <div className="t-small" style={{ marginTop: 4 }}>{result.summary}</div>
          </div>
        )}
      </div>

      <div style={{ padding: '12px 0 8px', display: 'flex', gap: 10 }}>
        <button type="button" className="btn" style={{ flex: 1 }} onClick={onEdit}>Edit</button>
        <button type="button" className="btn primary" style={{ flex: 1 }} onClick={onDone}>Looks good</button>
      </div>
    </div>
  )
}

function buildPreviewCards(text: string) {
  const parts = text
    .split(/[.!?]/)
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(part => part.length > 10)

  if (parts.length === 0) {
    return [
      { title: 'Prep demo on linking', priority: 'high' as const, badge: 'NEW' },
      { title: 'Tuesday agenda · v3', priority: 'medium' as const, badge: '+context' },
      { title: 'Recording flow polish', priority: 'low' as const, badge: 'NEW' },
    ]
  }

  return parts.slice(0, 3).map((part, index) => ({
    title: shorten(part),
    priority: index === 0 ? 'high' as const : index === 1 ? 'medium' as const : 'low' as const,
    badge: index === 1 ? '+context' : 'NEW',
  }))
}

function shorten(value: string) {
  if (value.length <= 34) return value
  return `${value.slice(0, 31).trim()}...`
}

function priorityColor(priority: 'low' | 'medium' | 'high') {
  if (priority === 'high') return 'var(--high)'
  if (priority === 'medium') return 'var(--med)'
  return 'var(--low)'
}

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
