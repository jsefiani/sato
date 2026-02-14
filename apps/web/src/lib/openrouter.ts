import { env } from '@/lib/env'

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
      Authorization: `Bearer ${env.OPENROUTER_PROVISIONING_KEY}`,
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
