'use client'

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary] Caught error', { error, componentStack: info.componentStack })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg)',
          color: 'var(--ink)',
          fontFamily: 'var(--body)',
          padding: 24,
        }}>
          <div style={{ maxWidth: 480, textAlign: 'center' }}>
            <div style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              background: 'color-mix(in oklch, var(--high) 12%, var(--surface))',
              border: '1px solid color-mix(in oklch, var(--high) 24%, var(--line))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
            }}>
              <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="var(--high)" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>
              Something went wrong
            </div>
            <div style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 24 }}>
              The dashboard ran into an unexpected error. Reload to try again — your data is safe in Supabase.
            </div>
            {this.state.error && (
              <div style={{
                padding: '10px 14px',
                borderRadius: 'var(--r-md)',
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                fontFamily: 'var(--mono)',
                fontSize: 12,
                color: 'var(--ink-2)',
                textAlign: 'left',
                wordBreak: 'break-all',
                marginBottom: 20,
              }}>
                {this.state.error.message}
              </div>
            )}
            <button
              type="button"
              className="btn primary"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
