import type { Metadata } from 'next'
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Toaster } from 'sonner'
import './globals.css'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
})

export const metadata: Metadata = {
  title: {
    default: 'BrainDump — AI Second Brain',
    template: '%s | BrainDump',
  },
  description:
    'Dump your thoughts freely — text or voice. AI extracts tasks, links related ideas, and builds a living picture of your commitments over time.',
  keywords: [
    'brain dump', 'AI task extraction', 'second brain', 'productivity',
    'voice notes', 'task manager', 'AI assistant', 'thought organizer',
    'Mistral', 'Hugging Face', 'Next.js',
  ],
  authors: [{ name: 'Ahmed Butt', url: 'https://github.com/ahmedthebutt' }],
  creator: 'Ahmed Butt',
  metadataBase: new URL('https://braindump.vercel.app'),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://braindump.vercel.app',
    siteName: 'BrainDump',
    title: 'BrainDump — AI Second Brain',
    description:
      'Dump your thoughts freely — text or voice. AI extracts tasks, links related ideas, and builds a living picture of your commitments over time.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BrainDump — AI Second Brain',
    description:
      'Dump your thoughts freely — text or voice. AI extracts tasks, links related ideas, and builds a living picture of your commitments over time.',
    creator: '@ahmedthebutt',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  icons: {
    icon: [
      { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png',  media: '(prefers-color-scheme: dark)'  },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="bg-background">
      <head>
        {/* Apply saved theme before first paint — prevents dark→light flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('bd-theme')==='dark')document.documentElement.classList.add('dark')}catch(_){}`,
          }}
        />
      </head>
      <body
        className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} font-sans antialiased min-h-screen`}
      >
        {children}
        <Toaster richColors position="bottom-right" />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
