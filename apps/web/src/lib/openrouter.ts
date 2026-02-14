import { getEnv, getOptionalEnv } from '@/lib/env'

const UUID_V4_COMPAT_REGEX =
  /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/

function isPlaceholderValue(value: string): boolean {
  return /^<[^>]+>$/.test(value)
}

function normalizeEnvValue(rawValue: string | null): string {
  const value = rawValue?.trim() ?? ''
  if (!value) {
    return ''
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim()
  }

  return value
}

interface OpenRouterKeyRecord {
  hash: string
  usage: number
  limit: number | null
  limit_remaining: number | null
  disabled: boolean
}

interface OpenRouterKeyResponse {
  data: OpenRouterKeyRecord
}

interface OpenRouterCreateKeyResponse {
  key: string
  data: OpenRouterKeyRecord
}

const OPENROUTER_API_BASE_URL = 'https://openrouter.ai/api/v1'

async function openRouterRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${OPENROUTER_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getEnv('OPENROUTER_PROVISIONING_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`)
  }

  if (response.status === 204) {
    return {} as T
  }

  const responseText = await response.text()
  if (!responseText) {
    return {} as T
  }

  return JSON.parse(responseText) as T
}

export async function createOpenRouterKey(input: {
  name: string
  limitUsd: number
}): Promise<{ key: string; hash: string; usageUsd: number }> {
  const response = await openRouterRequest<OpenRouterCreateKeyResponse>(
    '/keys',
    'POST',
    {
      name: input.name,
      limit: input.limitUsd,
      include_byok_in_limit: false,
    },
  )

  return {
    key: response.key,
    hash: response.data.hash,
    usageUsd: response.data.usage,
  }
}

export async function getOpenRouterKey(
  keyHash: string,
): Promise<{ usageUsd: number; limitUsd: number | null; disabled: boolean }> {
  const response = await openRouterRequest<OpenRouterKeyResponse>(
    `/keys/${keyHash}`,
    'GET',
  )

  return {
    usageUsd: response.data.usage,
    limitUsd: response.data.limit,
    disabled: response.data.disabled,
  }
}

export async function updateOpenRouterKey(
  keyHash: string,
  input: { limitUsd?: number | null; disabled?: boolean; name?: string },
): Promise<void> {
  const payload: Record<string, unknown> = {}

  if (typeof input.limitUsd !== 'undefined') {
    payload.limit = input.limitUsd
  }

  if (typeof input.disabled !== 'undefined') {
    payload.disabled = input.disabled
  }

  if (typeof input.name !== 'undefined') {
    payload.name = input.name
  }

  await openRouterRequest(`/keys/${keyHash}`, 'PATCH', payload)
}

export async function deleteOpenRouterKey(keyHash: string): Promise<void> {
  await openRouterRequest(`/keys/${keyHash}`, 'DELETE')
}

export async function assignGuardrailToOpenRouterKey(
  keyHash: string,
): Promise<void> {
  const rawGuardrailId = getOptionalEnv('OPENROUTER_GUARDRAIL_ID')
  const guardrailId = normalizeEnvValue(rawGuardrailId)

  if (!guardrailId) {
    return
  }

  if (isPlaceholderValue(guardrailId)) {
    return
  }

  if (!UUID_V4_COMPAT_REGEX.test(guardrailId)) {
    console.warn(
      'Ignoring OPENROUTER_GUARDRAIL_ID because it is not a valid UUID:',
      guardrailId,
    )
    return
  }

  try {
    await openRouterRequest(
      `/guardrails/${guardrailId}/assignments/keys`,
      'POST',
      {
        key_hashes: [keyHash],
      },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      'Failed to assign guardrail to OpenRouter key. Continuing without guardrail.',
      message,
    )
  }
}
