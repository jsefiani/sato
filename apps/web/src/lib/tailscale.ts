import { env } from '@/lib/env'

const TAILSCALE_API_BASE = 'https://api.tailscale.com/api/v2'

interface TailscaleAuthKey {
  id: string
  key: string
  expirySeconds: number
}

interface TailscaleAuthKeyResponse {
  id: string
  key: string
  expires: string
}

async function tailscaleRequest<T>(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<T> {
  const apiKey = env.TAILSCALE_API_KEY
  const response = await fetch(`${TAILSCALE_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Tailscale API error (${response.status}): ${errorText}`)
  }

  return (await response.json()) as T
}

interface TailscaleDevice {
  name: string
  addresses: Array<string>
}

interface TailscaleDevicesResponse {
  devices: Array<TailscaleDevice>
}

export async function findDeviceTailscaleIp({
  hostname,
}: {
  hostname: string
}): Promise<string | null> {
  const response = await tailscaleRequest<TailscaleDevicesResponse>(
    '/tailnet/-/devices',
    'GET',
  )

  const device = response.devices.find((d) => d.name.startsWith(hostname))
  if (!device) return null

  const ipv4 = device.addresses.find(
    (addr) => !addr.includes(':') && addr.startsWith('100.'),
  )
  return ipv4 ?? null
}

export async function createEphemeralAuthKey(): Promise<TailscaleAuthKey> {
  const response = await tailscaleRequest<TailscaleAuthKeyResponse>(
    '/tailnet/-/keys',
    'POST',
    {
      capabilities: {
        devices: {
          create: {
            reusable: false,
            ephemeral: true,
            preauthorized: true,
            tags: ['tag:sato-vps'],
          },
        },
      },
      expirySeconds: 600,
    },
  )

  return {
    id: response.id,
    key: response.key,
    expirySeconds: 600,
  }
}
