'use client'

import { useState, useRef, useCallback } from 'react'
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  // Web Speech API hook
  const {
    isListening,
    isSupported: webSpeechSupported,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
    resetTranscript,
    error: webSpeechError,
  } = useSpeechRecognition({
    continuous: true,
    interimResults: true,
    onResult: (text) => {
      onTranscript(text)
    },
    onError: (err) => {
      // If Web Speech fails, try fallback
      if (err.includes('not supported') || err.includes('denied')) {
        setIsFallbackMode(true)
      }
      setError(err)
    },
  })

  // Hugging Face Whisper fallback
  const startFallbackRecording = useCallback(async () => {
    try {
      setError(null)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream, { 
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      })
      
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop())
        
        // Send to Hugging Face API
        await transcribeWithHuggingFace(audioBlob)
      }

      mediaRecorder.start()
      setIsRecording(true)
    } catch (err) {
      setError('Microphone access denied. Please allow microphone access.')
      console.error('Failed to start recording:', err)
    }
  }, [])

  const stopFallbackRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }, [])

  const transcribeWithHuggingFace = async (audioBlob: Blob) => {
    setIsRecording(true) // Show loading state
    setError(null)
    
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
          setError(`Model loading... Try again in ${data.retryAfter}s`)
        } else if (data.fallbackRequired) {
          setError('Hugging Face API not configured. Use Web Speech API.')
          setIsFallbackMode(false) // Go back to Web Speech
        } else {
          setError(data.error || 'Transcription failed')
        }
        return
      }

      if (data.transcript) {
        onTranscript(data.transcript)
      }
    } catch (err) {
      setError('Failed to transcribe audio')
      console.error('Transcription error:', err)
    } finally {
      setIsRecording(false)
    }
  }

  const handleToggleRecording = () => {
    setError(null)

    if (isFallbackMode) {
      // Use Hugging Face fallback
      if (isRecording) {
        stopFallbackRecording()
      } else {
        startFallbackRecording()
      }
    } else {
      // Use Web Speech API
      if (isListening) {
        stopListening()
      } else {
        const started = startListening()
        if (!started && !webSpeechSupported) {
          // Web Speech not supported, switch to fallback
          setIsFallbackMode(true)
          startFallbackRecording()
        }
      }
    }
  }

  const activeListening = isListening || isRecording
  const currentError = error || webSpeechError

  return (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={activeListening ? "destructive" : "outline"}
              size="icon"
              onClick={handleToggleRecording}
              disabled={disabled}
              className="relative"
            >
              {activeListening ? (
                <>
                  <MicOff className="h-4 w-4" />
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive"></span>
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

        {/* Show interim transcript while listening */}
        {interimTranscript && (
          <span className="text-sm text-muted-foreground italic animate-pulse">
            {interimTranscript.slice(0, 50)}...
          </span>
        )}

        {/* Show recording indicator */}
        {activeListening && !interimTranscript && (
          <span className="flex items-center gap-1 text-sm text-destructive">
            <Loader2 className="h-3 w-3 animate-spin" />
            Listening...
          </span>
        )}

        {/* Show error */}
        {currentError && !activeListening && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 text-sm text-destructive">
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
