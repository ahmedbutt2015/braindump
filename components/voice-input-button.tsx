'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useSpeechRecognition } from '@/hooks/use-speech-recognition'
import { VoiceAnimationDisplay, VOICE_CHARACTERS } from '@/components/voice-animations'
import type { VoiceCharacter } from '@/components/voice-animations'
import { cn } from '@/lib/utils'

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void
  disabled?: boolean
}

const STORAGE_KEY = 'bd-voice-char'

export function VoiceInputButton({ onTranscript, disabled }: VoiceInputButtonProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [isFallbackMode, setIsFallbackMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null)
  const [character, setCharacter] = useState<VoiceCharacter>('neural')
  const [pickerOpen, setPickerOpen] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const pendingAudioRef = useRef<Blob | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Load saved character preference from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as VoiceCharacter | null
      if (saved && VOICE_CHARACTERS.some(c => c.id === saved)) {
        setCharacter(saved)
      }
    } catch { /* localStorage not available */ }
  }, [])

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pickerOpen])

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearInterval(retryTimerRef.current)
    }
  }, [])

  const saveCharacter = (c: VoiceCharacter) => {
    setCharacter(c)
    setPickerOpen(false)
    try { localStorage.setItem(STORAGE_KEY, c) } catch { /* ignore */ }
  }

  const {
    isListening,
    isSupported: webSpeechSupported,
    interimTranscript,
    startListening,
    stopListening,
    error: webSpeechError,
  } = useSpeechRecognition({
    continuous: true,
    interimResults: true,
    onResult: (text) => { onTranscript(text) },
    onError: (err) => {
      if (err.includes('not supported') || err.includes('denied')) setIsFallbackMode(true)
      setError(err)
    },
  })

  const startRetryCountdown = useCallback((secondsUntilRetry: number, audioBlob: Blob) => {
    pendingAudioRef.current = audioBlob
    setRetryCountdown(secondsUntilRetry)
    retryTimerRef.current = setInterval(() => {
      setRetryCountdown(prev => {
        if (prev === null || prev <= 1) {
          if (retryTimerRef.current) clearInterval(retryTimerRef.current)
          if (pendingAudioRef.current) transcribeWithHuggingFace(pendingAudioRef.current, true)
          return null
        }
        return prev - 1
      })
    }, 1000)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const transcribeWithHuggingFace = useCallback(async (audioBlob: Blob, isRetry = false) => {
    if (!isRetry) setError(null)
    setIsRecording(true)
    try {
      const formData = new FormData()
      formData.append('audio', audioBlob)
      const response = await fetch('/api/transcribe', { method: 'POST', body: formData })
      const data = await response.json()
      if (!response.ok) {
        if (data.modelLoading) {
          const wait = data.retryAfter ?? 20
          setError(`Warming up — retrying in ${wait}s`)
          startRetryCountdown(wait, audioBlob)
        } else if (data.fallbackRequired) {
          setError('Whisper not configured. Switching to browser voice.')
          setIsFallbackMode(false)
        } else {
          setError(data.error || 'Transcription failed')
        }
        return
      }
      setError(null)
      pendingAudioRef.current = null
      if (data.transcript) onTranscript(data.transcript)
    } catch {
      setError('Failed to transcribe. Check your connection.')
    } finally {
      setIsRecording(false)
    }
  }, [onTranscript, startRetryCountdown])

  const startFallbackRecording = useCallback(async () => {
    try {
      setError(null)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        stream.getTracks().forEach(t => t.stop())
        await transcribeWithHuggingFace(blob)
      }
      mediaRecorder.start()
      setIsRecording(true)
    } catch {
      setError('Microphone access denied.')
    }
  }, [transcribeWithHuggingFace])

  const stopFallbackRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }, [])

  const handleToggle = () => {
    if (retryTimerRef.current) {
      clearInterval(retryTimerRef.current)
      retryTimerRef.current = null
      setRetryCountdown(null)
      pendingAudioRef.current = null
    }
    setError(null)
    if (isFallbackMode) {
      isRecording ? stopFallbackRecording() : startFallbackRecording()
    } else {
      if (isListening) {
        stopListening()
      } else {
        const started = startListening()
        if (!started && !webSpeechSupported) {
          setIsFallbackMode(true)
          startFallbackRecording()
        }
      }
    }
  }

  const activeListening = isListening || isRecording
  const isWarmingUp = retryCountdown !== null
  const currentError = error || webSpeechError

  return (
    <div className="flex flex-col gap-2">
      {/* Main row: animation display + mic toggle + character picker trigger */}
      <div className="flex items-center gap-2">

        {/* Animation container — shows character animation idle/active */}
        <div
          className={cn(
            'relative flex items-center justify-center rounded-xl transition-all duration-300',
            activeListening
              ? 'bg-primary/8 ring-1 ring-primary/25 px-2'
              : 'opacity-70'
          )}
          style={{ width: 60, height: 40 }}
        >
          <VoiceAnimationDisplay character={character} isActive={activeListening} size={40} />
        </div>

        {/* Mic toggle button */}
        <button
          type="button"
          onClick={handleToggle}
          disabled={disabled || isWarmingUp}
          aria-label={activeListening ? 'Stop recording' : 'Start voice input'}
          className={cn(
            'relative flex items-center justify-center w-10 h-10 rounded-xl border transition-all duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            activeListening
              ? 'bg-primary border-primary text-primary-foreground shadow-lg shadow-primary/25'
              : 'bg-card border-border text-muted-foreground hover:border-primary/40 hover:text-primary',
            (disabled || isWarmingUp) && 'opacity-50 cursor-not-allowed'
          )}
        >
          {activeListening ? (
            <>
              {/* Recording indicator dot */}
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
              </span>
              {/* Stop icon */}
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                <rect x="4" y="4" width="8" height="8" rx="1.5" />
              </svg>
            </>
          ) : (
            /* Mic icon */
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
            </svg>
          )}
        </button>

        {/* Character picker trigger */}
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen(o => !o)}
            aria-label="Choose voice animation"
            className={cn(
              'flex items-center justify-center w-7 h-7 rounded-lg transition-all',
              pickerOpen
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:text-primary hover:bg-muted'
            )}
          >
            {/* Palette / customize icon */}
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="3" />
              <path strokeLinecap="round" d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </button>

          {/* Character picker dropdown */}
          {pickerOpen && (
            <div
              className="absolute bottom-full mb-2 right-0 z-50 bg-card border border-border rounded-xl shadow-xl p-3 min-w-max"
            >
              <p className="text-xs text-muted-foreground font-medium mb-2 font-mono uppercase tracking-wider">
                Voice character
              </p>
              <div className="flex gap-2">
                {VOICE_CHARACTERS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => saveCharacter(c.id)}
                    title={c.description}
                    className={cn(
                      'flex flex-col items-center gap-1.5 p-2 rounded-lg transition-all border',
                      character === c.id
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-transparent hover:border-border hover:bg-muted/50 text-muted-foreground'
                    )}
                  >
                    {/* Mini live preview */}
                    <div style={{ width: 32, height: 32 }} className="flex items-center justify-center">
                      <VoiceAnimationDisplay character={c.id} isActive={character === c.id} size={28} />
                    </div>
                    <span className="text-xs font-medium leading-none">{c.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Status text */}
        <div className="flex items-center gap-1.5 min-w-0">
          {activeListening && !interimTranscript && (
            <span className="text-xs text-primary font-medium">
              {isRecording && !isListening ? 'Transcribing…' : 'Listening…'}
            </span>
          )}
          {isWarmingUp && (
            <span className="text-xs text-muted-foreground">
              Retrying in {retryCountdown}s
            </span>
          )}
          {currentError && !activeListening && !isWarmingUp && (
            <span className="text-xs text-destructive truncate max-w-40" title={currentError}>
              {currentError}
            </span>
          )}
        </div>
      </div>

      {/* Interim transcript */}
      {interimTranscript && (
        <p className="text-xs text-muted-foreground italic pl-1 animate-pulse truncate max-w-xs">
          {interimTranscript}
        </p>
      )}
    </div>
  )
}
