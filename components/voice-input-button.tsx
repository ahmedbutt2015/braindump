'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useSpeechRecognition } from '@/hooks/use-speech-recognition'
import { Mic, MicOff, Loader2, AlertCircle } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void
  disabled?: boolean
}

export function VoiceInputButton({ onTranscript, disabled }: VoiceInputButtonProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [isFallbackMode, setIsFallbackMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const pendingAudioRef = useRef<Blob | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clean up retry timer on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearInterval(retryTimerRef.current)
    }
  }, [])

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
    onResult: (text) => {
      onTranscript(text)
    },
    onError: (err) => {
      if (err.includes('not supported') || err.includes('denied')) {
        setIsFallbackMode(true)
      }
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
          // Auto-retry with the saved audio blob
          if (pendingAudioRef.current) {
            transcribeWithHuggingFace(pendingAudioRef.current, true)
          }
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

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        if (data.modelLoading) {
          const waitSeconds = data.retryAfter ?? 20
          setError(`Model warming up — auto-retrying in ${waitSeconds}s`)
          startRetryCountdown(waitSeconds, audioBlob)
        } else if (data.fallbackRequired) {
          setError('Whisper API not configured. Switching to browser voice.')
          setIsFallbackMode(false)
        } else {
          setError(data.error || 'Transcription failed')
        }
        return
      }

      setError(null)
      pendingAudioRef.current = null
      if (data.transcript) {
        onTranscript(data.transcript)
      }
    } catch {
      setError('Failed to transcribe audio. Check your connection.')
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

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
        stream.getTracks().forEach(track => track.stop())
        await transcribeWithHuggingFace(audioBlob)
      }

      mediaRecorder.start()
      setIsRecording(true)
    } catch {
      setError('Microphone access denied. Please allow microphone access.')
    }
  }, [transcribeWithHuggingFace])

  const stopFallbackRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }, [])

  const handleToggleRecording = () => {
    // Cancel any pending retry if user clicks the button
    if (retryTimerRef.current) {
      clearInterval(retryTimerRef.current)
      retryTimerRef.current = null
      setRetryCountdown(null)
      pendingAudioRef.current = null
    }
    setError(null)

    if (isFallbackMode) {
      if (isRecording) {
        stopFallbackRecording()
      } else {
        startFallbackRecording()
      }
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
  const currentError = error || webSpeechError
  const isWarmingUp = retryCountdown !== null

  return (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={activeListening ? 'destructive' : 'outline'}
              size="icon"
              onClick={handleToggleRecording}
              disabled={disabled || isWarmingUp}
              className="relative"
            >
              {activeListening ? (
                <>
                  <MicOff className="h-4 w-4" />
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive" />
                  </span>
                </>
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {activeListening
              ? 'Click to stop recording'
              : isFallbackMode
                ? 'Voice input (Whisper)'
                : 'Voice input'}
          </TooltipContent>
        </Tooltip>

        {/* Interim transcript while Web Speech is listening */}
        {interimTranscript && (
          <span className="text-sm text-muted-foreground italic animate-pulse">
            {interimTranscript.slice(0, 50)}...
          </span>
        )}

        {/* Listening / transcribing indicator */}
        {activeListening && !interimTranscript && (
          <span className="flex items-center gap-1 text-sm text-destructive">
            <Loader2 className="h-3 w-3 animate-spin" />
            {isRecording && !isListening ? 'Transcribing...' : 'Listening...'}
          </span>
        )}

        {/* HF model warm-up countdown */}
        {isWarmingUp && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Retrying in {retryCountdown}s
          </span>
        )}

        {/* Error indicator */}
        {currentError && !activeListening && !isWarmingUp && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 text-sm text-destructive cursor-help">
                <AlertCircle className="h-3 w-3" />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {currentError}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  )
}
