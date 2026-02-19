export interface SupportedModel {
  value: string
  label: string
  description: string
}

export const SUPPORTED_MODELS: Array<SupportedModel> = [
  {
    value: 'openrouter/anthropic/claude-sonnet-4',
    label: 'Claude Sonnet 4',
    description: 'Best overall quality',
  },
  {
    value: 'openrouter/anthropic/claude-3.5-haiku',
    label: 'Claude Haiku 3.5',
    description: 'Fast and affordable',
  },
  {
    value: 'openrouter/openai/gpt-4.1-mini',
    label: 'GPT-4.1 Mini',
    description: 'Balanced speed and quality',
  },
  {
    value: 'openrouter/google/gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    description: 'Fastest responses',
  },
  {
    value: 'openrouter/moonshotai/kimi-k2.5',
    label: 'Kimi K2.5',
    description: 'Strong open-source reasoning model',
  },
  {
    value: 'openrouter/deepseek/deepseek-r1',
    label: 'DeepSeek R1',
    description: 'Open-source reasoning specialist',
  },
  {
    value: 'openrouter/qwen/qwen3-coder',
    label: 'Qwen3 Coder',
    description: 'Open-source coding model',
  },
  {
    value: 'openrouter/meta-llama/llama-3.3-70b-instruct',
    label: 'Llama 3.3 70B',
    description: 'Open-source general-purpose model',
  },
]

export const DEFAULT_MODEL = SUPPORTED_MODELS[0]

const validModelValues = new Set(SUPPORTED_MODELS.map((m) => m.value))
const LEGACY_MODEL_ALIASES: Record<string, string> = {
  'openrouter/anthropic/claude-haiku-3.5':
    'openrouter/anthropic/claude-3.5-haiku',
}

export function isValidModel(value: string): boolean {
  return value in LEGACY_MODEL_ALIASES || validModelValues.has(value)
}

export function normalizeModel(value: string | null | undefined): string {
  if (!value) {
    return DEFAULT_MODEL.value
  }

  const mapped = LEGACY_MODEL_ALIASES[value] ?? value
  if (validModelValues.has(mapped)) {
    return mapped
  }

  return DEFAULT_MODEL.value
}

export function getModelLabel(value: string | null | undefined): string {
  const normalized = normalizeModel(value)
  return (
    SUPPORTED_MODELS.find((model) => model.value === normalized)?.label ??
    DEFAULT_MODEL.label
  )
}

export function getModelValueByLabel(label: string): string | null {
  const normalizedLabel = label.trim()
  return (
    SUPPORTED_MODELS.find((model) => model.label === normalizedLabel)?.value ??
    null
  )
}
