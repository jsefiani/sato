#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE_DEFAULT="$SCRIPT_DIR/../.env.local"
ENV_FILE="${ENV_FILE:-$ENV_FILE_DEFAULT}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

for required_command in curl jq ssh; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "ERROR: Missing required command '$required_command'."
    exit 1
  fi
done

: "${HETZNER_API_TOKEN:?Missing HETZNER_API_TOKEN}"
: "${HETZNER_SSH_KEY_ID:?Missing HETZNER_SSH_KEY_ID}"
: "${HETZNER_SSH_PRIVATE_KEY_PATH:?Missing HETZNER_SSH_PRIVATE_KEY_PATH}"

HETZNER_SSH_PRIVATE_KEY_PATH="${HETZNER_SSH_PRIVATE_KEY_PATH/#\~/$HOME}"

if [ ! -f "$HETZNER_SSH_PRIVATE_KEY_PATH" ]; then
  echo "ERROR: SSH key not found at $HETZNER_SSH_PRIVATE_KEY_PATH"
  exit 1
fi

PROJECT_PREFIX="${PROJECT_PREFIX:-sato-dev}"
HETZNER_LOCATION="${HETZNER_LOCATION:-nbg1}"
HETZNER_IMAGE="${HETZNER_IMAGE:-ubuntu-24.04}"
HETZNER_NETWORK_ZONE="${HETZNER_NETWORK_ZONE:-eu-central}"
HETZNER_NETWORK_CIDR="${HETZNER_NETWORK_CIDR:-10.50.0.0/16}"
HETZNER_NETWORK_SUBNET_CIDR="${HETZNER_NETWORK_SUBNET_CIDR:-10.50.1.0/24}"
HETZNER_BASTION_SERVER_TYPE="${HETZNER_BASTION_SERVER_TYPE:-cpx21}"
HETZNER_COOLIFY_SERVER_TYPE="${HETZNER_COOLIFY_SERVER_TYPE:-cpx22}"

WG_PORT="${WG_PORT:-51820}"
WG_SERVER_ADDRESS="${WG_SERVER_ADDRESS:-10.99.0.1/24}"
WG_ADMIN_CLIENT_NAME="${WG_ADMIN_CLIENT_NAME:-admin-laptop}"
WG_ADMIN_CLIENT_IP="${WG_ADMIN_CLIENT_IP:-10.99.0.2/32}"
WG_ALLOWED_IPS="${WG_ALLOWED_IPS:-$HETZNER_NETWORK_CIDR}"

INSTALL_COOLIFY="${INSTALL_COOLIFY:-true}"
SKIP_CONFIRM="${SKIP_CONFIRM:-false}"
PRINT_WG_PRIVATE_KEY="${PRINT_WG_PRIVATE_KEY:-false}"

NETWORK_NAME="${NETWORK_NAME:-${PROJECT_PREFIX}-private-network}"
BASTION_NAME="${BASTION_NAME:-${PROJECT_PREFIX}-bastion}"
COOLIFY_NAME="${COOLIFY_NAME:-${PROJECT_PREFIX}-coolify}"
BASTION_FIREWALL_NAME="${BASTION_FIREWALL_NAME:-${PROJECT_PREFIX}-bastion-fw}"
COOLIFY_FIREWALL_NAME="${COOLIFY_FIREWALL_NAME:-${PROJECT_PREFIX}-coolify-fw}"

HETZNER_API_BASE_URL="https://api.hetzner.cloud/v1"

detect_admin_cidr() {
  local detected_ip
  detected_ip="$(curl -fsS --max-time 5 https://ipv4.icanhazip.com 2>/dev/null | tr -d '\n' || true)"

  if [ -n "$detected_ip" ]; then
    printf '%s/32' "$detected_ip"
  fi
}

ADMIN_SSH_CIDRS="${ADMIN_SSH_CIDRS:-$(detect_admin_cidr)}"
if [ -z "$ADMIN_SSH_CIDRS" ]; then
  ADMIN_SSH_CIDRS="0.0.0.0/0"
fi

WG_SOURCE_CIDRS="${WG_SOURCE_CIDRS:-0.0.0.0/0,::/0}"

KNOWN_HOSTS_FILE="$(mktemp -t sato-foundation-known-hosts.XXXXXX)"
cleanup() {
  if [ -f "$KNOWN_HOSTS_FILE" ]; then
    rm -f "$KNOWN_HOSTS_FILE"
  fi
}
trap cleanup EXIT

SSH_OPTS=(
  -o StrictHostKeyChecking=accept-new
  -o UserKnownHostsFile="$KNOWN_HOSTS_FILE"
  -o ConnectTimeout=5
  -o LogLevel=ERROR
  -i "$HETZNER_SSH_PRIVATE_KEY_PATH"
)

log_step() {
  printf '\n==> %s\n' "$1"
}

csv_to_json_array() {
  local csv="$1"
  jq -cn --arg csv "$csv" '$csv | split(",") | map(gsub("^ +| +$"; "")) | map(select(length > 0))'
}

resolve_server_type() {
  local preferred="$1"
  shift
  local candidates=("$preferred" "$@")
  local response candidate

  response="$(hcloud GET '/server_types?per_page=200')"

  for candidate in "${candidates[@]}"; do
    if [ -z "$candidate" ]; then
      continue
    fi

    if echo "$response" | jq -e \
      --arg type "$candidate" \
      --arg location "$HETZNER_LOCATION" \
      '.server_types[]
      | select(.name == $type)
      | select(.deprecated == false)
      | any(.locations[]; .name == $location and ((.deprecation.unavailable_after? // "") == ""))' >/dev/null; then
      echo "$candidate"
      return
    fi
  done

  echo "ERROR: No supported server type found for location '$HETZNER_LOCATION'." >&2
  exit 1
}

hcloud() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local response_file
  local status_code

  response_file="$(mktemp -t sato-hcloud-response.XXXXXX)"

  if [ -n "$data" ]; then
    status_code="$(curl -sS -X "$method" \
      -H "Authorization: Bearer $HETZNER_API_TOKEN" \
      -H "Content-Type: application/json" \
      --data "$data" \
      -o "$response_file" \
      -w '%{http_code}' \
      "$HETZNER_API_BASE_URL$path")"
  else
    status_code="$(curl -sS -X "$method" \
      -H "Authorization: Bearer $HETZNER_API_TOKEN" \
      -o "$response_file" \
      -w '%{http_code}' \
      "$HETZNER_API_BASE_URL$path")"
  fi

  if [ "$status_code" -ge 400 ]; then
    echo "Hetzner API error ($status_code) on $method $path" >&2
    cat "$response_file" >&2
    rm -f "$response_file"
    return 1
  fi

  cat "$response_file"
  rm -f "$response_file"
}

ensure_network() {
  local response network_id payload

  response="$(hcloud GET "/networks?name=$NETWORK_NAME")"
  network_id="$(echo "$response" | jq -r '.networks[0].id // empty')"

  if [ -n "$network_id" ]; then
    echo "$network_id"
    return
  fi

  payload="$(jq -cn \
    --arg name "$NETWORK_NAME" \
    --arg ip_range "$HETZNER_NETWORK_CIDR" \
    --arg network_zone "$HETZNER_NETWORK_ZONE" \
    --arg subnet_range "$HETZNER_NETWORK_SUBNET_CIDR" \
    --arg project "$PROJECT_PREFIX" \
    '{
      name: $name,
      ip_range: $ip_range,
      labels: {
        project: $project,
        managed_by: "sato-bootstrap",
        role: "private-network"
      },
      subnets: [
        {
          type: "cloud",
          network_zone: $network_zone,
          ip_range: $subnet_range
        }
      ]
    }')"

  response="$(hcloud POST "/networks" "$payload")"
  echo "$response" | jq -r '.network.id'
}

ensure_firewall() {
  local name="$1"
  local rules_json="$2"
  local role="$3"
  local response firewall_id create_payload update_payload

  response="$(hcloud GET "/firewalls?name=$name")"
  firewall_id="$(echo "$response" | jq -r '.firewalls[0].id // empty')"

  if [ -n "$firewall_id" ]; then
    update_payload="$(jq -cn --argjson rules "$rules_json" '{rules: $rules}')"
    hcloud POST "/firewalls/$firewall_id/actions/set_rules" "$update_payload" >/dev/null
    echo "$firewall_id"
    return
  fi

  create_payload="$(jq -cn \
    --arg name "$name" \
    --arg project "$PROJECT_PREFIX" \
    --arg role "$role" \
    --argjson rules "$rules_json" \
    '{
      name: $name,
      labels: {
        project: $project,
        managed_by: "sato-bootstrap",
        role: $role
      },
      rules: $rules
    }')"

  response="$(hcloud POST "/firewalls" "$create_payload")"
  echo "$response" | jq -r '.firewall.id'
}

ensure_server() {
  local name="$1"
  local server_type="$2"
  local firewall_id="$3"
  local role="$4"
  local user_data="$5"
  local response existing_id create_payload

  response="$(hcloud GET "/servers?name=$name")"
  existing_id="$(echo "$response" | jq -r '.servers[0].id // empty')"

  if [ -n "$existing_id" ]; then
    echo "$response" | jq -r '[.servers[0].id, (.servers[0].public_net.ipv4.ip // ""), (.servers[0].private_net[0].ip // "")] | @tsv'
    return
  fi

  create_payload="$(jq -cn \
    --arg name "$name" \
    --arg server_type "$server_type" \
    --arg image "$HETZNER_IMAGE" \
    --arg location "$HETZNER_LOCATION" \
    --arg user_data "$user_data" \
    --arg ssh_key_id "$HETZNER_SSH_KEY_ID" \
    --arg firewall_id "$firewall_id" \
    --arg network_id "$NETWORK_ID" \
    --arg project "$PROJECT_PREFIX" \
    --arg role "$role" \
    '{
      name: $name,
      server_type: $server_type,
      image: $image,
      location: $location,
      user_data: $user_data,
      ssh_keys: [($ssh_key_id | tonumber)],
      firewalls: [{ firewall: ($firewall_id | tonumber) }],
      networks: [($network_id | tonumber)],
      labels: {
        project: $project,
        managed_by: "sato-bootstrap",
        role: $role
      }
    }')"

  response="$(hcloud POST "/servers" "$create_payload")"
  echo "$response" | jq -r '[.server.id, (.server.public_net.ipv4.ip // ""), (.server.private_net[0].ip // "")] | @tsv'
}

wait_for_ssh() {
  local host="$1"
  local label="$2"

  for _attempt in $(seq 1 60); do
    if ssh "${SSH_OPTS[@]}" "root@$host" "echo ready" >/dev/null 2>&1; then
      return
    fi

    sleep 5
  done

  echo "ERROR: Timed out waiting for SSH on $label ($host)"
  exit 1
}

extract_key_value() {
  local key="$1"
  local content="$2"

  while IFS= read -r line; do
    case "$line" in
      "$key"=*)
        printf '%s\n' "${line#*=}"
        return
        ;;
    esac
  done <<<"$content"

  return 1
}

HETZNER_BASTION_SERVER_TYPE="$(resolve_server_type \
  "$HETZNER_BASTION_SERVER_TYPE" \
  "cpx21" \
  "cpx22" \
  "cpx31" \
  "cx22" \
  "cx32")"

HETZNER_COOLIFY_SERVER_TYPE="$(resolve_server_type \
  "$HETZNER_COOLIFY_SERVER_TYPE" \
  "cpx22" \
  "cpx31" \
  "cpx41" \
  "cx22" \
  "cx32")"

if [ "$SKIP_CONFIRM" != "true" ] && [ -t 0 ]; then
  cat <<EOF
This will create or reuse the following Hetzner resources:
- Private network: $NETWORK_NAME ($HETZNER_NETWORK_CIDR)
- Bastion server: $BASTION_NAME ($HETZNER_BASTION_SERVER_TYPE)
- Coolify server: $COOLIFY_NAME ($HETZNER_COOLIFY_SERVER_TYPE)
- Firewalls: $BASTION_FIREWALL_NAME, $COOLIFY_FIREWALL_NAME

Location: $HETZNER_LOCATION
WireGuard port: $WG_PORT
Admin SSH CIDRs: $ADMIN_SSH_CIDRS

Continue? [y/N]
EOF
  read -r answer
  if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then
    echo "Aborted."
    exit 0
  fi
fi

ADMIN_SSH_CIDRS_JSON="$(csv_to_json_array "$ADMIN_SSH_CIDRS")"
WG_SOURCE_CIDRS_JSON="$(csv_to_json_array "$WG_SOURCE_CIDRS")"

log_step "Ensuring private network '$NETWORK_NAME'"
NETWORK_ID="$(ensure_network)"
echo "Network ID: $NETWORK_ID"

log_step "Ensuring bastion firewall '$BASTION_FIREWALL_NAME'"
BASTION_RULES_JSON="$(jq -cn \
  --argjson ssh_sources "$ADMIN_SSH_CIDRS_JSON" \
  --argjson wg_sources "$WG_SOURCE_CIDRS_JSON" \
  --arg wg_port "$WG_PORT" \
  '[
    {
      direction: "in",
      protocol: "tcp",
      port: "22",
      source_ips: $ssh_sources
    },
    {
      direction: "in",
      protocol: "udp",
      port: $wg_port,
      source_ips: $wg_sources
    }
  ]')"

BASTION_FIREWALL_ID="$(ensure_firewall "$BASTION_FIREWALL_NAME" "$BASTION_RULES_JSON" "bastion-firewall")"
echo "Bastion firewall ID: $BASTION_FIREWALL_ID"

log_step "Ensuring bastion server '$BASTION_NAME'"
read -r BASTION_SERVER_ID BASTION_PUBLIC_IP BASTION_PRIVATE_IP < <(
  ensure_server \
    "$BASTION_NAME" \
    "$HETZNER_BASTION_SERVER_TYPE" \
    "$BASTION_FIREWALL_ID" \
    "bastion" \
    "#cloud-config
package_update: true
packages:
  - wireguard
  - fail2ban
"
)

echo "Bastion server ID: $BASTION_SERVER_ID"
echo "Bastion public IP: $BASTION_PUBLIC_IP"
echo "Bastion private IP: $BASTION_PRIVATE_IP"

if [ -z "$BASTION_PUBLIC_IP" ] || [ -z "$BASTION_PRIVATE_IP" ]; then
  echo "ERROR: Could not determine bastion public/private IPs."
  exit 1
fi

log_step "Waiting for bastion SSH"
wait_for_ssh "$BASTION_PUBLIC_IP" "$BASTION_NAME"

log_step "Bootstrapping WireGuard on bastion"
WG_BOOTSTRAP_OUTPUT="$({
  ssh "${SSH_OPTS[@]}" "root@$BASTION_PUBLIC_IP" \
    "bash -s -- '$WG_PORT' '$WG_SERVER_ADDRESS' '$WG_ADMIN_CLIENT_NAME' '$WG_ADMIN_CLIENT_IP'" <<'REMOTE_SCRIPT'
set -euo pipefail

WG_PORT="$1"
WG_SERVER_ADDRESS="$2"
WG_ADMIN_CLIENT_NAME="$3"
WG_ADMIN_CLIENT_IP="$4"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq wireguard >/dev/null

install -d -m 700 /etc/wireguard /etc/wireguard/clients

if [ ! -f /etc/wireguard/private.key ]; then
  umask 077
  wg genkey | tee /etc/wireguard/private.key | wg pubkey > /etc/wireguard/public.key
fi

SERVER_PRIVATE_KEY="$(cat /etc/wireguard/private.key)"
cat > /etc/wireguard/wg0.conf <<WGCONF
[Interface]
Address = ${WG_SERVER_ADDRESS}
ListenPort = ${WG_PORT}
PrivateKey = ${SERVER_PRIVATE_KEY}
SaveConfig = false
WGCONF

grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
grep -q '^net.ipv6.conf.all.forwarding=1' /etc/sysctl.conf || echo 'net.ipv6.conf.all.forwarding=1' >> /etc/sysctl.conf
sysctl -w net.ipv4.ip_forward=1 >/dev/null
sysctl -w net.ipv6.conf.all.forwarding=1 >/dev/null

CLIENT_PRIVATE_PATH="/etc/wireguard/clients/${WG_ADMIN_CLIENT_NAME}.private"
CLIENT_PUBLIC_PATH="/etc/wireguard/clients/${WG_ADMIN_CLIENT_NAME}.public"

if [ ! -f "$CLIENT_PRIVATE_PATH" ]; then
  umask 077
  wg genkey | tee "$CLIENT_PRIVATE_PATH" | wg pubkey > "$CLIENT_PUBLIC_PATH"
fi

CLIENT_PUBLIC_KEY="$(cat "$CLIENT_PUBLIC_PATH")"

if ! grep -q "$CLIENT_PUBLIC_KEY" /etc/wireguard/wg0.conf; then
  cat >> /etc/wireguard/wg0.conf <<WGPEER

[Peer]
PublicKey = ${CLIENT_PUBLIC_KEY}
AllowedIPs = ${WG_ADMIN_CLIENT_IP}
PersistentKeepalive = 25
WGPEER
fi

systemctl enable wg-quick@wg0 >/dev/null
systemctl restart wg-quick@wg0

echo "CLIENT_PRIVATE_KEY=$(cat "$CLIENT_PRIVATE_PATH")"
echo "CLIENT_PUBLIC_KEY=$CLIENT_PUBLIC_KEY"
echo "SERVER_PUBLIC_KEY=$(cat /etc/wireguard/public.key)"
REMOTE_SCRIPT
} 2>/dev/null)"

WG_CLIENT_PRIVATE_KEY="$(extract_key_value CLIENT_PRIVATE_KEY "$WG_BOOTSTRAP_OUTPUT" || true)"
WG_SERVER_PUBLIC_KEY="$(extract_key_value SERVER_PUBLIC_KEY "$WG_BOOTSTRAP_OUTPUT" || true)"

if [ -z "$WG_CLIENT_PRIVATE_KEY" ] || [ -z "$WG_SERVER_PUBLIC_KEY" ]; then
  echo "ERROR: WireGuard bootstrap failed."
  exit 1
fi

COOLIFY_SSH_SOURCES_JSON="$(jq -cn \
  --argjson admin_sources "$ADMIN_SSH_CIDRS_JSON" \
  --arg bastion_source "$BASTION_PRIVATE_IP/32" \
  '$admin_sources + [$bastion_source]')"

log_step "Ensuring Coolify firewall '$COOLIFY_FIREWALL_NAME'"
COOLIFY_RULES_JSON="$(jq -cn \
  --argjson ssh_sources "$COOLIFY_SSH_SOURCES_JSON" \
  --argjson dashboard_sources "$ADMIN_SSH_CIDRS_JSON" \
  '[
    {
      direction: "in",
      protocol: "tcp",
      port: "22",
      source_ips: $ssh_sources
    },
    {
      direction: "in",
      protocol: "tcp",
      port: "80",
      source_ips: ["0.0.0.0/0", "::/0"]
    },
    {
      direction: "in",
      protocol: "tcp",
      port: "443",
      source_ips: ["0.0.0.0/0", "::/0"]
    },
    {
      direction: "in",
      protocol: "tcp",
      port: "8000",
      source_ips: $dashboard_sources
    }
  ]')"

COOLIFY_FIREWALL_ID="$(ensure_firewall "$COOLIFY_FIREWALL_NAME" "$COOLIFY_RULES_JSON" "coolify-firewall")"
echo "Coolify firewall ID: $COOLIFY_FIREWALL_ID"

log_step "Ensuring Coolify server '$COOLIFY_NAME'"
read -r COOLIFY_SERVER_ID COOLIFY_PUBLIC_IP COOLIFY_PRIVATE_IP < <(
  ensure_server \
    "$COOLIFY_NAME" \
    "$HETZNER_COOLIFY_SERVER_TYPE" \
    "$COOLIFY_FIREWALL_ID" \
    "coolify" \
    "#cloud-config
package_update: true
"
)

echo "Coolify server ID: $COOLIFY_SERVER_ID"
echo "Coolify public IP: $COOLIFY_PUBLIC_IP"
echo "Coolify private IP: $COOLIFY_PRIVATE_IP"

if [ -z "$COOLIFY_PUBLIC_IP" ] || [ -z "$COOLIFY_PRIVATE_IP" ]; then
  echo "ERROR: Could not determine coolify public/private IPs."
  exit 1
fi

log_step "Waiting for Coolify SSH"
wait_for_ssh "$COOLIFY_PUBLIC_IP" "$COOLIFY_NAME"

if [ "$INSTALL_COOLIFY" = "true" ]; then
  log_step "Installing Coolify"
  ssh "${SSH_OPTS[@]}" "root@$COOLIFY_PUBLIC_IP" "bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

for _attempt in $(seq 1 120); do
  if [ -f /var/lib/cloud/instance/boot-finished ]; then
    break
  fi

  sleep 2
done

for _attempt in $(seq 1 120); do
  if ! pgrep -x apt >/dev/null 2>&1 \
    && ! pgrep -x apt-get >/dev/null 2>&1 \
    && ! pgrep -x dpkg >/dev/null 2>&1 \
    && ! pgrep -x unattended-upgr >/dev/null 2>&1; then
    break
  fi

  sleep 2
done

curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
REMOTE_SCRIPT
fi

WG_CLIENT_PRIVATE_KEY_DISPLAY="[hidden]"
WG_PRIVATE_KEY_NOTE="WireGuard private key is stored on bastion at /etc/wireguard/clients/${WG_ADMIN_CLIENT_NAME}.private"

if [ "$PRINT_WG_PRIVATE_KEY" = "true" ]; then
  WG_CLIENT_PRIVATE_KEY_DISPLAY="$WG_CLIENT_PRIVATE_KEY"
  WG_PRIVATE_KEY_NOTE=""
fi

cat <<EOF

Done. Foundation infrastructure is ready.

Resource summary:
- Network: $NETWORK_NAME (id: $NETWORK_ID)
- Bastion: $BASTION_NAME (id: $BASTION_SERVER_ID, public: $BASTION_PUBLIC_IP, private: $BASTION_PRIVATE_IP)
- Coolify: $COOLIFY_NAME (id: $COOLIFY_SERVER_ID, public: $COOLIFY_PUBLIC_IP, private: $COOLIFY_PRIVATE_IP)

WireGuard client profile ($WG_ADMIN_CLIENT_NAME):

[Interface]
PrivateKey = $WG_CLIENT_PRIVATE_KEY_DISPLAY
Address = ${WG_ADMIN_CLIENT_IP%/32}/32
DNS = 1.1.1.1

[Peer]
PublicKey = $WG_SERVER_PUBLIC_KEY
AllowedIPs = $WG_ALLOWED_IPS
Endpoint = $BASTION_PUBLIC_IP:$WG_PORT
PersistentKeepalive = 25

$WG_PRIVATE_KEY_NOTE

Next app env values:
- VPS_SSH_BASTION_HOST=$BASTION_PRIVATE_IP
- VPS_SSH_BASTION_USER=root
- VPS_SSH_BASTION_PORT=22

Coolify URL:
- http://$COOLIFY_PUBLIC_IP:8000

EOF
