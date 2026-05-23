'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

interface UseSpeechRecognitionOptions {
  onResult?: (transcript: string) => void
  onError?: (error: string) => void
  continuous?: boolean
  interimResults?: boolean
  language?: string
}

interface SpeechRecognitionState {
  isListening: boolean
  isSupported: boolean
  transcript: string
  interimTranscript: string
  error: string | null
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionResultList {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  isFinal: boolean
  length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message?: string
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance
    webkitSpeechRecognition: new () => SpeechRecognitionInstance
  }
}

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

// Safari uses webkitSpeechRecognition and doesn't support continuous mode reliably.
// We detect this and simulate continuous mode by restarting after each utterance.
function isSafariBrowser(): boolean {
  if (typeof window === 'undefined') return false
  return !window.SpeechRecognition && !!window.webkitSpeechRecognition
}

export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}) {
  const {
    onResult,
    onError,
    continuous = false,
    interimResults = true,
    language = 'en-US',
  } = options

  const [state, setState] = useState<SpeechRecognitionState>({
    isListening: false,
    isSupported: false,
    transcript: '',
    interimTranscript: '',
    error: null,
  })

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  // Tracks whether the user intends to keep listening (for Safari continuous simulation)
  const shouldContinueRef = useRef(false)

  useEffect(() => {
    setState(prev => ({ ...prev, isSupported: !!getSpeechRecognition() }))
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldContinueRef.current = false
      recognitionRef.current?.abort()
    }
  }, [])

  const createAndStartRecognition = useCallback(() => {
    const SpeechRecognition = getSpeechRecognition()
    if (!SpeechRecognition) return

    if (recognitionRef.current) {
      recognitionRef.current.abort()
    }

    const recognition = new SpeechRecognition()
    recognitionRef.current = recognition

    const safari = isSafariBrowser()
    // Safari crashes or silently stops with continuous=true; we simulate it ourselves
    recognition.continuous = safari ? false : continuous
    // Safari interimResults support is unreliable; disable it there
    recognition.interimResults = safari ? false : interimResults
    recognition.lang = language

    recognition.onstart = () => {
      setState(prev => ({
        ...prev,
        isListening: true,
        error: null,
        interimTranscript: '',
      }))
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = ''
      let interim = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalTranscript += result[0].transcript
        } else {
          interim += result[0].transcript
        }
      }

      setState(prev => ({
        ...prev,
        transcript: prev.transcript + finalTranscript,
        interimTranscript: interim,
      }))

      if (finalTranscript) {
        onResult?.(finalTranscript)
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // 'no-speech' on Safari is benign during continuous simulation — just restart
      if (event.error === 'no-speech' && safari && shouldContinueRef.current) return

      const errorMessage =
        event.error === 'not-allowed'
          ? 'Microphone access denied. Please allow microphone access.'
          : event.error === 'no-speech'
          ? 'No speech detected. Please try again.'
          : `Speech recognition error: ${event.error}`

      setState(prev => ({ ...prev, error: errorMessage, isListening: false }))
      onError?.(errorMessage)
    }

    recognition.onend = () => {
      // On Safari with continuous requested: restart automatically while the user
      // hasn't explicitly stopped. This simulates the continuous mode that Safari lacks.
      if (safari && continuous && shouldContinueRef.current) {
        try {
          recognition.start()
          return
        } catch {
          // If restart fails, fall through to stop
        }
      }
      setState(prev => ({ ...prev, isListening: false, interimTranscript: '' }))
    }

    try {
      recognition.start()
    } catch {
      setState(prev => ({ ...prev, error: 'Failed to start speech recognition' }))
      onError?.('Failed to start speech recognition')
    }
  }, [continuous, interimResults, language, onResult, onError])

  const startListening = useCallback(() => {
    const SpeechRecognition = getSpeechRecognition()
    if (!SpeechRecognition) {
      setState(prev => ({ ...prev, error: 'Speech recognition not supported' }))
      onError?.('Speech recognition not supported in this browser')
      return false
    }

    shouldContinueRef.current = true
    setState(prev => ({ ...prev, transcript: '', interimTranscript: '', error: null }))
    createAndStartRecognition()
    return true
  }, [createAndStartRecognition, onError])

  const stopListening = useCallback(() => {
    shouldContinueRef.current = false
    recognitionRef.current?.stop()
    setState(prev => ({ ...prev, isListening: false, interimTranscript: '' }))
  }, [])

  const resetTranscript = useCallback(() => {
    setState(prev => ({ ...prev, transcript: '', interimTranscript: '' }))
  }, [])

  return {
    ...state,
    startListening,
    stopListening,
    resetTranscript,
  }
}
