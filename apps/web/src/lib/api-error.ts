function isMessageSafe(message: string): boolean {
  if (SAFE_ERROR_MESSAGES.has(message)) {
    return true
  }

  return SAFE_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix))
}

export function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Something went wrong'
  }

  if (isMessageSafe(error.message)) {
    return error.message
  }

  console.error('[api-error] Suppressed error:', error.message)
  return 'Something went wrong'
}

export function safeApiResponse(
  error: unknown,
  fallbackStatus = 500,
): Response {
  const message = safeErrorMessage(error)
  const status = message === 'Unauthorized' ? 401 : fallbackStatus
  return Response.json({ error: message }, { status })
}

const SAFE_ERROR_MESSAGES = new Set([
  'Unauthorized',
  'Missing stripe-signature header',
  'No VPS instance found',
  'VPS has no IP address yet',
  'This account already has a VPS instance',
  'Your free trial has expired or your subscription is inactive. Please subscribe to continue.',
  'You are out of credits. Buy a credit pack to keep using your assistant.',
  'No Stripe customer found for this user',
  'Missing top-up pack',
  'Unknown top-up pack',
  'Stripe checkout did not return a URL',
  'Telegram bot token is required',
  'That token format looks invalid. Double-check the BotFather token and try again.',
  'Pairing code is required',
  'Pairing code should be 8 uppercase letters/numbers (without 0/1).',
])

const SAFE_ERROR_PREFIXES = [
  'Assistant setup failed on this VPS.',
  'Assistant setup is still in progress.',
  'Assistant is not ready for',
  'Failed to fully remove server resources:',
  'Unable to clean up previous failed resources:',
]
