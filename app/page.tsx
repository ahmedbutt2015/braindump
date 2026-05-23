import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { BrainMascot } from '@/components/brain-mascot'
import { BrainGlyph, Logo } from '@/components/logo'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  return (
    <div style={{ fontFamily: 'var(--body)', background: 'var(--bg)', color: 'var(--ink)', minHeight: '100svh' }}>

      {/* ── Sticky nav ── */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50,
        padding: '0 48px', height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'color-mix(in oklch, var(--bg) 75%, transparent)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--line)',
      }}>
        <Logo size="sm" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, fontSize: 13.5, color: 'var(--muted-foreground)' }}>
          <span style={{ cursor: 'default' }}>How it works</span>
          <span style={{ cursor: 'default' }}>Memory</span>
          <span style={{ cursor: 'default' }}>Pricing</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link href="/auth/login" style={{
            display: 'inline-flex', alignItems: 'center',
            height: 34, padding: '0 14px', borderRadius: 'var(--r-sm)',
            fontSize: 13, fontWeight: 500, color: 'var(--muted-foreground)',
            textDecoration: 'none', background: 'transparent', border: '1px solid transparent',
          }}>
            Sign in
          </Link>
          <Link href="/auth/sign-up" style={{
            display: 'inline-flex', alignItems: 'center',
            height: 34, padding: '0 14px', borderRadius: 'var(--r-sm)',
            fontSize: 13, fontWeight: 500, color: 'white',
            textDecoration: 'none', background: 'var(--ink)', border: '1px solid var(--ink)',
          }}>
            Start dumping
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ position: 'relative', padding: '72px 56px 88px', overflow: 'hidden' }}>
        <div className="neural-bg" />
        <div style={{
          position: 'relative', zIndex: 1,
          display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 48, alignItems: 'center',
          maxWidth: 1200, margin: '0 auto',
        }}>
          {/* Left: copy */}
          <div>
            <div className="t-eyebrow" style={{ marginBottom: 16 }}>
              a second brain that actually reads what you put in it
            </div>
            <h1 className="t-h1" style={{ fontSize: 68, marginBottom: 20, lineHeight: 1.02 }}>
              Your thoughts<br />
              <span style={{ color: 'var(--violet)' }}>don&apos;t disappear</span> here.
            </h1>
            <p style={{ fontSize: 18, lineHeight: 1.6, color: 'var(--muted-foreground)', maxWidth: 500, marginBottom: 32 }}>
              Hold to talk. Let go to think. BrainDump turns raw thoughts into linked tasks —
              and remembers everything you mention, so new dumps enrich old ones instead of piling up.
            </p>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Link href="/auth/sign-up" style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                height: 52, padding: '0 24px', borderRadius: 'var(--r-md)',
                fontSize: 16, fontWeight: 500, color: 'white',
                background: 'var(--violet)', textDecoration: 'none',
                boxShadow: '0 8px 24px color-mix(in oklch, var(--violet) 35%, transparent)',
              }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="5" y="1" width="4" height="8" rx="2" fill="white" />
                  <path d="M2 6.5a5 5 0 0010 0" stroke="white" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                  <path d="M7 11.5v2M5 13.5h4" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                Start dumping free
              </Link>
              <Link href="/auth/login" style={{
                display: 'inline-flex', alignItems: 'center',
                height: 52, padding: '0 24px', borderRadius: 'var(--r-md)',
                fontSize: 16, fontWeight: 500, color: 'var(--ink)',
                background: 'var(--surface)', textDecoration: 'none',
                border: '1px solid var(--line)',
              }}>
                Sign in →
              </Link>
            </div>
            <div className="t-mono" style={{ color: 'var(--muted-foreground)', marginTop: 16 }}>
              free · 100 dumps · no credit card
            </div>
          </div>

          {/* Right: brain mascot + floating task bubbles */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <BrainMascot size={340} state="listening" />

              {/* Floating task bubbles */}
              <div style={{
                position: 'absolute', top: 20, right: -50,
                padding: '8px 14px', borderRadius: 'var(--r-pill)',
                background: 'var(--surface)', boxShadow: 'var(--shadow-3)',
                fontSize: 12, display: 'flex', alignItems: 'center', gap: 8,
                border: '1px solid var(--line)', whiteSpace: 'nowrap',
                animation: 'float-slow 3.2s ease-in-out infinite',
              }}>
                <span className="chip dot hue-high" style={{ height: 18, fontSize: 10 }}>high</span>
                Email Jake @ CyberX
              </div>
              <div style={{
                position: 'absolute', bottom: 80, left: -60,
                padding: '8px 14px', borderRadius: 'var(--r-pill)',
                background: 'var(--surface)', boxShadow: 'var(--shadow-3)',
                fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
                border: '1px solid var(--line)', whiteSpace: 'nowrap',
                animation: 'float-slow 2.8s ease-in-out infinite 0.6s',
              }}>
                <span style={{ color: 'var(--violet)' }}>↳</span> Research security roles
              </div>
              <div style={{
                position: 'absolute', bottom: 10, right: 0,
                padding: '8px 14px', borderRadius: 'var(--r-pill)',
                background: 'var(--surface)', boxShadow: 'var(--shadow-3)',
                fontSize: 12, display: 'flex', alignItems: 'center', gap: 8,
                border: '1px solid var(--line)', whiteSpace: 'nowrap',
                animation: 'float-slow 3.6s ease-in-out infinite 1.2s',
              }}>
                <span className="chip dot hue-done" style={{ height: 18, fontSize: 10 }}>done</span>
                Pay Beth $32
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Three things ── */}
      <section style={{ padding: '0 56px 72px', maxWidth: 1200 + 112, margin: '0 auto' }}>
        <div className="t-eyebrow" style={{ marginBottom: 20 }}>three things it does</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[
            { n: '01', t: 'Dump freely', d: 'Voice or text. No structure, no tags, no format. Just say what\'s on your mind.' },
            { n: '02', t: 'AI extracts tasks', d: 'Priority, due dates, and context — all lifted from your words and past 11 weeks.' },
            { n: '03', t: 'It links the dots', d: 'Mention a person or idea twice — the second dump enriches the first task automatically.' },
          ].map(c => (
            <div key={c.n} style={{
              padding: 24, borderRadius: 'var(--r-lg)',
              background: 'var(--surface)', border: '1px solid var(--line)',
              boxShadow: 'var(--shadow-1)', minHeight: 190,
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            }}>
              <span className="t-mono" style={{ color: 'var(--violet)' }}>{c.n}</span>
              <div>
                <div className="t-h3" style={{ marginBottom: 10, fontSize: 20 }}>{c.t}</div>
                <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--muted-foreground)', margin: 0 }}>{c.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Example dump strip ── */}
      <section style={{ padding: '0 56px 80px', maxWidth: 1200 + 112, margin: '0 auto' }}>
        <div style={{
          padding: '28px 32px', borderRadius: 'var(--r-lg)',
          background: 'var(--surface-2)', border: '1px solid var(--line)',
          display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 28, alignItems: 'center',
        }}>
          <div>
            <div className="t-eyebrow" style={{ marginBottom: 10 }}>you dump</div>
            <div style={{ fontSize: 17, color: 'var(--ink)', lineHeight: 1.55 }}>
              &ldquo;Met Jake at the networking event, he&apos;s a hiring manager at{' '}
              <span style={{
                background: 'color-mix(in oklch, var(--violet) 18%, transparent)',
                padding: '0 4px', borderRadius: 4,
              }}>CyberX</span>.&rdquo;
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: 'var(--violet)' }}>
            <BrainGlyph size={30} filled />
            <svg width="2" height="24" viewBox="0 0 2 24">
              <line x1="1" y1="0" x2="1" y2="24" stroke="var(--violet)" strokeWidth="1.5" strokeDasharray="3 3" />
            </svg>
            <svg width="14" height="10" viewBox="0 0 14 10">
              <path d="M7 0v8M2 4l5 5 5-5" stroke="var(--violet)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </div>

          <div>
            <div className="t-eyebrow" style={{ marginBottom: 10 }}>braindump enriches</div>
            <div style={{ fontSize: 15.5, color: 'var(--ink)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--violet)' }}>Research security job openings</strong>{' '}
              — contact Jake from CyberX (met at networking event).
            </div>
            <div className="t-mono" style={{ color: 'var(--muted-foreground)', marginTop: 10 }}>
              existing task · enriched · not duplicated
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA strip ── */}
      <section style={{
        margin: '0 56px 80px', padding: '48px 56px',
        borderRadius: 'var(--r-xl)', position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(135deg, color-mix(in oklch, var(--violet) 12%, var(--surface)) 0%, var(--surface) 70%)',
        border: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 40,
      }}>
        <div className="neural-bg" style={{ opacity: 0.5 }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="t-h2" style={{ marginBottom: 10 }}>Ready to clear your head?</div>
          <p style={{ fontSize: 16, color: 'var(--muted-foreground)', margin: 0, maxWidth: 480 }}>
            Free to start. No credit card. Your first 100 dumps are on us.
          </p>
        </div>
        <div style={{ position: 'relative', zIndex: 1, flexShrink: 0 }}>
          <Link href="/auth/sign-up" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            height: 52, padding: '0 28px', borderRadius: 'var(--r-md)',
            fontSize: 16, fontWeight: 600, color: 'white',
            background: 'var(--violet)', textDecoration: 'none',
            boxShadow: '0 8px 24px color-mix(in oklch, var(--violet) 35%, transparent)',
          }}>
            Start dumping free →
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{
        padding: '24px 56px', borderTop: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Logo size="sm" />
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <Link href="/auth/login" style={{ fontSize: 13, color: 'var(--muted-foreground)', textDecoration: 'none' }}>Sign in</Link>
          <Link href="/auth/sign-up" style={{ fontSize: 13, color: 'var(--muted-foreground)', textDecoration: 'none' }}>Sign up</Link>
        </div>
        <div className="t-mono" style={{ color: 'var(--muted-foreground)' }}>
          MIT · Ahmed Butt
        </div>
      </footer>
    </div>
  )
}
