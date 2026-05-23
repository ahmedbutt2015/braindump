type HuggingFaceTokenSource = 'HUGGINGFACE_API_TOKEN' | 'NEXT_PUBLIC_HUGGINGFACE_API_TOKEN'

export function getHuggingFaceToken(): {
  token: string | null
  source: HuggingFaceTokenSource | null
} {
  const serverToken = process.env.HUGGINGFACE_API_TOKEN?.trim()
  if (serverToken) {
    return {
      token: serverToken,
      source: 'HUGGINGFACE_API_TOKEN',
    }
  }

  const publicToken = process.env.NEXT_PUBLIC_HUGGINGFACE_API_TOKEN?.trim()
  if (publicToken) {
    return {
      token: publicToken,
      source: 'NEXT_PUBLIC_HUGGINGFACE_API_TOKEN',
    }
  }

  return {
    token: null,
    source: null,
  }
}

export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null
  if (secret.length <= 8) return `${secret.slice(0, 2)}...${secret.slice(-2)}`
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`
}

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    const cause =
      error.cause && typeof error.cause === 'object'
        ? {
            name: 'name' in error.cause ? String(error.cause.name) : undefined,
            message: 'message' in error.cause ? String(error.cause.message) : undefined,
            code: 'code' in error.cause ? String(error.cause.code) : undefined,
            errno: 'errno' in error.cause ? String(error.cause.errno) : undefined,
            syscall: 'syscall' in error.cause ? String(error.cause.syscall) : undefined,
            hostname: 'hostname' in error.cause ? String(error.cause.hostname) : undefined,
          }
        : undefined

    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause,
    }
  }

  return { value: error }
}
