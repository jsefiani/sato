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

interface HetznerImage {
  id: number
  type: string
  status: string
}

interface HetznerImageResponse {
  image: HetznerImage
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
const DEBUG_ALLOW_PUBLIC_SSH = env.HETZNER_DEBUG_ALLOW_PUBLIC_SSH === 'true'
const DEBUG_SSH_SOURCE_IPS = env.HETZNER_DEBUG_SSH_SOURCE_IPS.split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0)

interface HetznerFirewallRule {
  direction: 'in'
  protocol: 'tcp'
  port: string
  source_ips: Array<string>
}

function buildFirewallRules(): Array<HetznerFirewallRule> {
  const rules: Array<HetznerFirewallRule> = []

  if (DEBUG_ALLOW_PUBLIC_SSH && DEBUG_SSH_SOURCE_IPS.length > 0) {
    rules.push({
      direction: 'in',
      protocol: 'tcp',
      port: '22',
      source_ips: DEBUG_SSH_SOURCE_IPS,
    })
  }

  return rules
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
    const image =
      body && typeof body === 'object' && 'image' in body
        ? String((body as { image?: unknown }).image ?? '')
        : ''
    const nameLabel = name ? ` [name=${name}]` : ''
    const imageLabel = image ? ` [image=${image}]` : ''

    throw new Error(
      `Hetzner API error (${response.status}) on ${method} ${path}${nameLabel}${imageLabel}: ${errorText}`,
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

export async function assertSnapshotAvailable({
  snapshotId,
}: {
  snapshotId: string
}): Promise<void> {
  try {
    const response = await hetznerRequest<HetznerImageResponse>(
      `/images/${snapshotId}`,
      'GET',
    )
    const image = response.image

    if (image.type !== 'snapshot') {
      throw new Error(
        `Configured image '${snapshotId}' is not a snapshot image in Hetzner.`,
      )
    }

    if (image.status !== 'available') {
      throw new Error(
        `Configured snapshot '${snapshotId}' is not available (status: ${image.status}).`,
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const lower = message.toLowerCase()

    if (
      lower.includes('hetzner api error (404)') ||
      lower.includes('image not found') ||
      lower.includes('"code":"not_found"') ||
      lower.includes('"code": "not_found"')
    ) {
      throw new Error(
        `Configured VPS snapshot '${snapshotId}' was not found for the active Hetzner API token.`,
      )
    }

    throw error
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
      rules: buildFirewallRules(),
    },
  )

  return String(response.firewall.id)
}

export async function createServer(
  input: HetznerCreateServerInput,
  firewallId: string,
): Promise<{ serverId: string; ipv4Address: string | null }> {
  const requestBody: Record<string, unknown> = {
    name: input.name,
    server_type: input.serverType,
    image: input.image,
    location: input.region,
    backups: false,
    user_data: input.userData,
    labels: input.labels,
    firewalls: [{ firewall: Number(firewallId) }],
  }

  if (env.HETZNER_SSH_KEY_ID) {
    requestBody.ssh_keys = [Number(env.HETZNER_SSH_KEY_ID)]
  }

  const response = await hetznerRequest<HetznerServerCreateResponse>(
    '/servers',
    'POST',
    requestBody,
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
