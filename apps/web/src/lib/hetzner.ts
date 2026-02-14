import { env } from '@/lib/env'

interface HetznerFirewall {
  id: number
}

interface HetznerServer {
  id: number
  public_net?: {
    ipv4?: {
      ip?: string
    }
  }
}

interface HetznerServerCreateResponse {
  server: HetznerServer
}

interface HetznerFirewallCreateResponse {
  firewall: HetznerFirewall
}

interface HetznerServerTypeLocation {
  name: string
  deprecation: {
    announced: string
    unavailable_after: string
  } | null
}

interface HetznerServerType {
  id: number
  name: string
  deprecated: boolean
  locations: Array<HetznerServerTypeLocation>
}

interface HetznerServerTypesResponse {
  server_types: Array<HetznerServerType>
}

export interface HetznerLabels {
  [key: string]: string
}

interface HetznerCreateFirewallInput {
  name: string
  labels?: HetznerLabels
}

interface HetznerCreateServerInput {
  name: string
  region: string
  serverType: string
  userData: string
  labels?: HetznerLabels
  image: string
}

const HETZNER_API_BASE_URL = 'https://api.hetzner.cloud/v1'
const SERVER_TYPE_ALIAS: Record<string, string> = {
  cx22: 'cpx22',
}

async function hetznerRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${HETZNER_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.HETZNER_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const errorText = await response.text()
    const name =
      body && typeof body === 'object' && 'name' in body
        ? String((body as { name?: unknown }).name ?? '')
        : ''
    const nameLabel = name ? ` [name=${name}]` : ''

    throw new Error(
      `Hetzner API error (${response.status}) on ${method} ${path}${nameLabel}: ${errorText}`,
    )
  }

  if (response.status === 204) {
    return {} as T
  }

  return (await response.json()) as T
}

export function normalizeHetznerServerType(
  rawServerType: string | null | undefined,
): string {
  const normalized = (rawServerType ?? 'cpx22').trim().toLowerCase()
  return SERVER_TYPE_ALIAS[normalized] ?? normalized
}

export async function assertServerTypeAvailable(
  serverType: string,
  region: string,
): Promise<void> {
  const response = await hetznerRequest<HetznerServerTypesResponse>(
    '/server_types?per_page=200',
    'GET',
  )

  const selectedType = response.server_types.find(
    (entry) => entry.name === serverType,
  )

  if (!selectedType) {
    throw new Error(
      `Server type '${serverType}' is not available in Hetzner. Please use cpx22.`,
    )
  }

  if (selectedType.deprecated) {
    throw new Error(
      `Server type '${serverType}' is deprecated. Please use cpx22.`,
    )
  }

  const location = selectedType.locations.find((entry) => entry.name === region)

  if (!location) {
    throw new Error(
      `Server type '${serverType}' is not available in region '${region}'.`,
    )
  }

  if (location.deprecation?.unavailable_after) {
    throw new Error(
      `Server type '${serverType}' is unavailable in region '${region}'. Please use cpx22.`,
    )
  }
}

export async function createFirewall(
  input: HetznerCreateFirewallInput,
): Promise<string> {
  const response = await hetznerRequest<HetznerFirewallCreateResponse>(
    '/firewalls',
    'POST',
    {
      name: input.name,
      labels: input.labels,
      rules: [
        {
          direction: 'in',
          protocol: 'tcp',
          port: '80',
          source_ips: ['0.0.0.0/0', '::/0'],
        },
        {
          direction: 'in',
          protocol: 'tcp',
          port: '443',
          source_ips: ['0.0.0.0/0', '::/0'],
        },
        {
          direction: 'in',
          protocol: 'tcp',
          port: '18789',
          source_ips: ['0.0.0.0/0', '::/0'],
        },
      ],
    },
  )

  return String(response.firewall.id)
}

export async function createServer(
  input: HetznerCreateServerInput,
  firewallId: string,
): Promise<{ serverId: string; ipv4Address: string | null }> {
  const response = await hetznerRequest<HetznerServerCreateResponse>(
    '/servers',
    'POST',
    {
      name: input.name,
      server_type: input.serverType,
      image: input.image,
      location: input.region,
      user_data: input.userData,
      labels: input.labels,
      ssh_keys: [Number(env.HETZNER_SSH_KEY_ID)],
      firewalls: [{ firewall: Number(firewallId) }],
    },
  )

  return {
    serverId: String(response.server.id),
    ipv4Address: response.server.public_net?.ipv4?.ip ?? null,
  }
}

export async function removeFirewallFromServer(
  firewallId: string,
  serverId: string,
): Promise<void> {
  await hetznerRequest(
    `/firewalls/${firewallId}/actions/remove_from_resources`,
    'POST',
    {
      remove_from: [{ type: 'server', server: { id: Number(serverId) } }],
    },
  )
}

export async function deleteServer(serverId: string): Promise<void> {
  await hetznerRequest(`/servers/${serverId}`, 'DELETE')
}

export async function deleteFirewall(firewallId: string): Promise<void> {
  await hetznerRequest(`/firewalls/${firewallId}`, 'DELETE')
}
