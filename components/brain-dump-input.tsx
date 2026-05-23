'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { VoiceInputButton } from '@/components/voice-input-button'

interface BrainDumpInputProps {
  onSubmit: (content: string) => Promise<void>
  isProcessing: boolean
}

export function BrainDumpInput({ onSubmit, isProcessing }: BrainDumpInputProps) {
  const [content, setContent] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!content.trim() || isProcessing) return
    await onSubmit(content)
    setContent('')
  }

  const handleVoiceTranscript = (transcript: string) => {
    setContent(prev => prev.trim() ? `${prev} ${transcript}` : transcript)
  }

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2.5">
          {/* Brain icon */}
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
            </svg>
          </div>
          Dump Your Thoughts
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Write or speak freely — AI extracts tasks and links them to your existing work.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Textarea
            placeholder="What's on your mind? Meetings, ideas, reminders, anything…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-36 resize-none bg-background/50 border-border/50 focus:border-primary/50 font-sans text-sm leading-relaxed"
            disabled={isProcessing}
          />

          {/* Bottom bar: voice on left, char count + submit on right */}
          <div className="flex items-start justify-between gap-4">
            <VoiceInputButton onTranscript={handleVoiceTranscript} disabled={isProcessing} />

            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-muted-foreground tabular-nums">
                {content.length > 0 ? `${content.length} chars` : ''}
              </span>
              <Button
                type="submit"
                disabled={!content.trim() || isProcessing}
                className="min-w-36 shadow-sm shadow-primary/20"
              >
                {isProcessing ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Processing…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Extract Tasks
                  </span>
                )}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
