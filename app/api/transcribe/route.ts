import { createClient } from '@/lib/supabase/server'
import { checkTranscribeRateLimit } from '@/lib/rate-limit'

const HUGGINGFACE_API_URL = 'https://api-inference.huggingface.co/models/openai/whisper-large-v3'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { allowed, resetInSeconds } = checkTranscribeRateLimit(user.id)
    if (!allowed) {
      return Response.json(
        { error: `Rate limit reached. Try again in ${Math.ceil(resetInSeconds / 60)} minutes.` },
        { status: 429 }
      )
    }

    // Check for HuggingFace API token
    const hfToken = process.env.NEXT_PUBLIC_HUGGINGFACE_API_TOKEN
    if (!hfToken) {
      return Response.json({ 
        error: 'Hugging Face API token not configured',
        fallbackRequired: true 
      }, { status: 503 })
    }

    // Get the audio blob from the request
    const formData = await request.formData()
    const audioFile = formData.get('audio') as Blob | null

    if (!audioFile) {
      return Response.json({ error: 'No audio file provided' }, { status: 400 })
    }

    // Convert blob to array buffer
    const audioBuffer = await audioFile.arrayBuffer()

    // Send to Hugging Face Whisper API
    const response = await fetch(HUGGINGFACE_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hfToken}`,
        'Content-Type': 'audio/webm',
      },
      body: audioBuffer,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      
      // Handle model loading state (Hugging Face free tier)
      if (response.status === 503 && errorData.error?.includes('loading')) {
        return Response.json({ 
          error: 'Model is loading, please try again in a few seconds',
          retryAfter: errorData.estimated_time || 20,
          modelLoading: true
        }, { status: 503 })
      }
      
      console.error('Hugging Face API error:', errorData)
      return Response.json({ 
        error: 'Transcription failed',
        details: errorData.error || 'Unknown error'
      }, { status: 500 })
    }

    const result = await response.json()
    
    // Hugging Face returns { text: "..." }
    const transcript = result.text || ''

    return Response.json({ 
      success: true,
      transcript: transcript.trim()
    })

  } catch (error) {
    console.error('Error in transcribe API:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
