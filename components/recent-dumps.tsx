'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDistanceToNow } from 'date-fns'

export interface BrainDump {
  id: string
  content: string
  created_at: string
}

interface RecentDumpsProps {
  dumps: BrainDump[]
  isLoading?: boolean
}

export function RecentDumps({ dumps, isLoading }: RecentDumpsProps) {
  if (isLoading) {
    return (
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Memory</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <svg className="animate-spin w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (dumps.length === 0) {
    return (
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            Recent Memory
          </CardTitle>
          <CardDescription className="text-xs">Your brain dumps will appear here</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">No memories yet</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          Recent Memory
        </CardTitle>
        <CardDescription className="text-xs">Last {dumps.length} brain dump{dumps.length > 1 ? 's' : ''}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {dumps.map(dump => (
          <div 
            key={dump.id} 
            className="p-3 rounded-lg bg-muted/30 border border-border/30"
          >
            <p className="text-sm line-clamp-3 text-foreground/80">{dump.content}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {formatDistanceToNow(new Date(dump.created_at), { addSuffix: true })}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
