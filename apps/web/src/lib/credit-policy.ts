export const CREDITS_PER_USD = 1000
export const DEFAULT_TRIAL_INCLUDED_CREDITS = 1500
export const DEFAULT_MONTHLY_INCLUDED_CREDITS = 12_000

export const TOPUP_PACK_CREDITS = {
  pack_10: 4000,
  pack_25: 10000,
  pack_50: 22000,
} as const

export function roundToUsd(value: number): number {
  return Math.max(0, Number(value.toFixed(6)))
}

export function creditsToUsd(credits: number): number {
  return roundToUsd(credits / CREDITS_PER_USD)
}
