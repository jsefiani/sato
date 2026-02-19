#!/usr/bin/env bash
#
# build-snapshot.sh — Create a Hetzner snapshot with OpenClaw pre-installed.
#
# Usage:
#   bash apps/web/scripts/build-snapshot.sh [OPENCLAW_VERSION]
#
# Automatically loads HETZNER_API_TOKEN, HETZNER_SSH_KEY_ID, and
# HETZNER_SSH_PRIVATE_KEY_PATH from apps/web/.env (if present).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.local"
OVERRIDE_HETZNER_API_TOKEN="${HETZNER_API_TOKEN:-}"
OVERRIDE_HETZNER_SSH_KEY_ID="${HETZNER_SSH_KEY_ID:-}"
OVERRIDE_SSH_PRIVATE_KEY_PATH="${SSH_PRIVATE_KEY_PATH:-}"
OVERRIDE_HETZNER_SSH_PRIVATE_KEY_PATH="${HETZNER_SSH_PRIVATE_KEY_PATH:-}"

if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

if [ -n "$OVERRIDE_HETZNER_API_TOKEN" ]; then
  HETZNER_API_TOKEN="$OVERRIDE_HETZNER_API_TOKEN"
fi

if [ -n "$OVERRIDE_HETZNER_SSH_KEY_ID" ]; then
  HETZNER_SSH_KEY_ID="$OVERRIDE_HETZNER_SSH_KEY_ID"
fi

if [ -n "$OVERRIDE_HETZNER_SSH_PRIVATE_KEY_PATH" ]; then
  HETZNER_SSH_PRIVATE_KEY_PATH="$OVERRIDE_HETZNER_SSH_PRIVATE_KEY_PATH"
fi

OPENCLAW_VERSION="${1:-2026.2.9}"
HETZNER_API="https://api.hetzner.cloud/v1"
SERVER_TYPE="cpx22"
LOCATION="nbg1"
IMAGE="ubuntu-24.04"
SNAPSHOT_DESCRIPTION="sato-openclaw-${OPENCLAW_VERSION}"
SNAPSHOT_DEBUG_PUBLIC_SSH="${SNAPSHOT_DEBUG_PUBLIC_SSH:-false}"
SSH_PRIVATE_KEY_PATH="${SSH_PRIVATE_KEY_PATH:-${HETZNER_SSH_PRIVATE_KEY_PATH:-}}"
RELEASE_NOTES_FILE="$SCRIPT_DIR/../docs/snapshot-release-notes.md"
if [ -n "$OVERRIDE_SSH_PRIVATE_KEY_PATH" ]; then
  SSH_PRIVATE_KEY_PATH="$OVERRIDE_SSH_PRIVATE_KEY_PATH"
fi
REMOTE_PROVISION_ATTEMPTS=3

: "${HETZNER_API_TOKEN:?Missing HETZNER_API_TOKEN}"
: "${HETZNER_SSH_KEY_ID:?Missing HETZNER_SSH_KEY_ID}"
: "${SSH_PRIVATE_KEY_PATH:?Missing SSH_PRIVATE_KEY_PATH (set HETZNER_SSH_PRIVATE_KEY_PATH in .env)}"

hetzner() {
  local method="$1" path="$2"
  shift 2
  local status tmp response
  tmp="$(mktemp -t sato-hetzner-response.XXXXXX)"

  status="$(
    curl --silent --show-error --location --ipv4 --http1.1 \
      --retry 8 --retry-delay 2 --retry-all-errors --retry-max-time 120 \
      --connect-timeout 10 --max-time 120 \
      -X "$method" \
      -H "Authorization: Bearer $HETZNER_API_TOKEN" \
      -H "Content-Type: application/json" \
      -o "$tmp" \
      -w '%{http_code}' \
      "${HETZNER_API}${path}" "$@"
  )" || {
    local exit_code=$?
    echo "ERROR: Hetzner API transport failure on ${method} ${path} (curl exit ${exit_code})" >&2
    if [ -s "$tmp" ]; then
      cat "$tmp" >&2
    fi
    rm -f "$tmp"
    return "$exit_code"
  }

  if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
    echo "ERROR: Hetzner API returned HTTP ${status} on ${method} ${path}" >&2
    if [ -s "$tmp" ]; then
      cat "$tmp" >&2
    fi
    rm -f "$tmp"
    return 1
  fi

  response="$(cat "$tmp")"
  rm -f "$tmp"
  printf '%s' "$response"
}

preflight_checks() {
  echo "Running Hetzner API preflight checks..."
  hetzner GET /locations > /dev/null
  hetzner GET "/ssh_keys/$HETZNER_SSH_KEY_ID" > /dev/null
}

cleanup_server() {
  if [ -n "${SERVER_ID:-}" ]; then
    echo "Cleaning up: deleting server $SERVER_ID..."
    hetzner DELETE "/servers/$SERVER_ID" || true
  fi
}

cleanup() {
  cleanup_server

  if [ -n "${KNOWN_HOSTS_FILE:-}" ] && [ -f "$KNOWN_HOSTS_FILE" ]; then
    rm -f "$KNOWN_HOSTS_FILE"
  fi
}

trap cleanup EXIT

append_snapshot_release_notes() {
  local notes_dir today built_at
  notes_dir="$(dirname "$RELEASE_NOTES_FILE")"
  today="$(date -u +%Y-%m-%d)"
  built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  mkdir -p "$notes_dir"

  if [ ! -f "$RELEASE_NOTES_FILE" ]; then
    cat > "$RELEASE_NOTES_FILE" << 'HEADER'
# VPS Snapshot Release Notes

This file tracks Hetzner snapshot builds for Sato user VPSes.
HEADER
  fi

  if grep -Fq "Snapshot ID: \`$IMAGE_ID\`" "$RELEASE_NOTES_FILE"; then
    echo "Release notes already include snapshot $IMAGE_ID."
    return 0
  fi

  cat >> "$RELEASE_NOTES_FILE" << EOF

## ${today} - Snapshot ${IMAGE_ID}
- Snapshot ID: \`${IMAGE_ID}\`
- Description: \`${SNAPSHOT_DESCRIPTION}\`
- OpenClaw version: \`${OPENCLAW_VERSION}\`
- Base image: \`${IMAGE}\`
- Builder profile: \`${SERVER_TYPE}\` in \`${LOCATION}\`
- Gateway/network defaults in snapshot:
  - UFW deny incoming by default
  - allow \`tailscale0\` TCP 22
  - allow \`tailscale0\` TCP 18789
  - public SSH debug mode: \`${SNAPSHOT_DEBUG_PUBLIC_SSH}\`
- Built at (UTC): \`${built_at}\`
- Notes:
  - Snapshot prepared for loopback OpenClaw gateway access with Tailscale control-plane routing.
EOF

  echo "Appended release notes entry to $RELEASE_NOTES_FILE"
}

preflight_checks

# ─── Step 1: Create temporary server ────────────────────────────────────────
echo "Creating temporary server ($SERVER_TYPE in $LOCATION)..."
CREATE_RESPONSE=$(hetzner POST /servers -d "{
  \"name\": \"sato-snapshot-builder-$(date +%s)\",
  \"server_type\": \"$SERVER_TYPE\",
  \"image\": \"$IMAGE\",
  \"location\": \"$LOCATION\",
  \"ssh_keys\": [$HETZNER_SSH_KEY_ID]
}")

SERVER_ID=$(echo "$CREATE_RESPONSE" | jq -r '.server.id')
SERVER_IP=$(echo "$CREATE_RESPONSE" | jq -r '.server.public_net.ipv4.ip')

if [ -z "$SERVER_ID" ] || [ "$SERVER_ID" = "null" ]; then
  echo "ERROR: Failed to create server"
  echo "$CREATE_RESPONSE" | jq . 2>/dev/null || echo "$CREATE_RESPONSE"
  exit 1
fi

echo "Server created: id=$SERVER_ID ip=$SERVER_IP"

# ─── Step 2: Wait for SSH ───────────────────────────────────────────────────
echo "Waiting for SSH to become available..."
KNOWN_HOSTS_FILE="$(mktemp -t sato-known-hosts.XXXXXX)"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$KNOWN_HOSTS_FILE -o ConnectTimeout=5 -o LogLevel=ERROR -i $SSH_PRIVATE_KEY_PATH"

for i in $(seq 1 60); do
  if ssh $SSH_OPTS "root@$SERVER_IP" "echo ready" 2>/dev/null; then
    echo "SSH is ready."
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "ERROR: SSH not available after 5 minutes"
    exit 1
  fi
  sleep 5
done

# ─── Step 3: Provision the server ──────────────────────────────────────────
echo "Installing packages and OpenClaw v${OPENCLAW_VERSION}..."

run_remote_provision() {
  ssh $SSH_OPTS \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=6 \
    "root@$SERVER_IP" \
    bash -s -- "$OPENCLAW_VERSION" "$SNAPSHOT_DEBUG_PUBLIC_SSH" << 'REMOTE_SCRIPT'
set -euo pipefail
OPENCLAW_VERSION="$1"
DEBUG_PUBLIC_SSH="${2:-false}"

export HOME=/root
export DEBIAN_FRONTEND=noninteractive

# System packages
apt-get update -qq
apt-get install -y -qq curl git ufw fail2ban unattended-upgrades

# Automatic security updates
cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'UUCFG'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
UUCFG

cat > /etc/apt/apt.conf.d/20auto-upgrades << 'AUTOCFG'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
AUTOCFG

# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | bash
systemctl enable tailscaled

# UFW firewall rules
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0 to any port 18789 proto tcp
if [ "$DEBUG_PUBLIC_SSH" = "true" ]; then
  ufw allow 22/tcp
else
  ufw allow in on tailscale0 to any port 22 proto tcp
fi
ufw --force enable

# Enable fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# Create unprivileged openclaw user
if ! id -u openclaw >/dev/null 2>&1; then
  useradd --system --shell /usr/sbin/nologin --home-dir /opt/openclaw --create-home openclaw
fi

# Install OpenClaw
export NO_COLOR=1 CLICOLOR=0 FORCE_COLOR=0
if ! curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-prompt --no-onboard --no-gum --version "$OPENCLAW_VERSION"; then
  echo "ERROR: Failed to install OpenClaw $OPENCLAW_VERSION"
  exit 1
fi

export PATH="/root/.local/bin:/root/.npm-global/bin:$PATH"

# Verify openclaw is installed
openclaw --version

# Create working directory and set ownership
mkdir -p /opt/openclaw
chown openclaw:openclaw /opt/openclaw

# Find the actual binary path for the systemd unit
OPENCLAW_BIN=$(command -v openclaw)
echo "OpenClaw binary: $OPENCLAW_BIN"

# Ensure binary is accessible system-wide (installer may place it under /root/)
if [[ "$OPENCLAW_BIN" == /root/* ]]; then
  cp "$OPENCLAW_BIN" /usr/local/bin/openclaw
  chmod 755 /usr/local/bin/openclaw
  OPENCLAW_BIN=/usr/local/bin/openclaw
  echo "Copied OpenClaw binary to $OPENCLAW_BIN"
fi

# Create hardened systemd service (enabled but NOT started — no config yet)
cat > /etc/systemd/system/openclaw-gateway.service << UNIT
[Unit]
Description=OpenClaw Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$OPENCLAW_BIN gateway run
Restart=on-failure
RestartSec=5
WorkingDirectory=/opt/openclaw

User=openclaw
Group=openclaw

Environment=HOME=/opt/openclaw
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=NODE_OPTIONS=--max-old-space-size=1536

# Sandboxing
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/openclaw
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes

# Resource limits
CPUQuota=80%
MemoryMax=2G
MemorySwapMax=0
LimitNOFILE=4096
TasksMax=64

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable openclaw-gateway

# Snapshot quality gate: fail fast if required runtime dependencies are missing.
for REQUIRED_BIN in ufw tailscale openclaw; do
  if ! command -v "$REQUIRED_BIN" >/dev/null 2>&1; then
    echo "ERROR: Required binary missing before snapshot: $REQUIRED_BIN"
    exit 1
  fi
done

if ! systemctl is-enabled --quiet tailscaled; then
  echo "ERROR: tailscaled is not enabled before snapshot"
  exit 1
fi

if ! systemctl is-enabled --quiet openclaw-gateway; then
  echo "ERROR: openclaw-gateway is not enabled before snapshot"
  exit 1
fi

if ! ufw status | grep -q '^Status: active'; then
  echo "ERROR: ufw is not active before snapshot"
  exit 1
fi

# Clean up for snapshot
apt-get clean
rm -rf /var/lib/apt/lists/*
rm -rf /tmp/* /var/tmp/*
journalctl --rotate && journalctl --vacuum-time=1s 2>/dev/null || true
> /var/log/syslog 2>/dev/null || true
> /var/log/auth.log 2>/dev/null || true
history -c 2>/dev/null || true
> /root/.bash_history 2>/dev/null || true

# Clear stale hostname so cloud-init sets it fresh from Hetzner metadata on next boot
truncate -s 0 /etc/hostname

# Clear Tailscale daemon state so it doesn't conflict with fresh tailscale up
systemctl stop tailscaled 2>/dev/null || true
rm -rf /var/lib/tailscale/*

# Reset machine-id so each instance gets a unique identity
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id
mkdir -p /var/lib/dbus
ln -sf /etc/machine-id /var/lib/dbus/machine-id

# Reset cloud-init state aggressively so snapshots always process fresh user_data
if ! command -v cloud-init >/dev/null 2>&1; then
  echo "ERROR: cloud-init binary not found on snapshot builder"
  exit 1
fi

rm -rf /var/lib/cloud/*
rm -f /etc/cloud/cloud-init.disabled
cloud-init clean --logs --seed

for UNIT in cloud-init-local.service cloud-init.service cloud-config.service cloud-final.service; do
  systemctl unmask "$UNIT" 2>/dev/null || true
  systemctl enable "$UNIT"
done

echo "Snapshot preparation complete."
REMOTE_SCRIPT
}

REMOTE_PROVISION_DONE=0
for ATTEMPT in $(seq 1 "$REMOTE_PROVISION_ATTEMPTS"); do
  if run_remote_provision; then
    REMOTE_PROVISION_DONE=1
    break
  fi

  if [ "$ATTEMPT" -lt "$REMOTE_PROVISION_ATTEMPTS" ]; then
    echo "Remote provisioning attempt ${ATTEMPT}/${REMOTE_PROVISION_ATTEMPTS} failed. Retrying in 10s..."
    sleep 10
  fi
done

if [ "$REMOTE_PROVISION_DONE" -ne 1 ]; then
  echo "ERROR: Remote provisioning failed after ${REMOTE_PROVISION_ATTEMPTS} attempts"
  exit 1
fi

echo "Server provisioned successfully."

# ─── Step 4: Shut down the server ──────────────────────────────────────────
echo "Shutting down server for snapshot..."
hetzner POST "/servers/$SERVER_ID/actions/shutdown" -d '{}' > /dev/null

# Wait for server to be off
for i in $(seq 1 30); do
  STATUS=$(hetzner GET "/servers/$SERVER_ID" | jq -r '.server.status')
  if [ "$STATUS" = "off" ]; then
    echo "Server is off."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Server did not shut down after 150 seconds"
    exit 1
  fi
  sleep 5
done

# ─── Step 5: Create snapshot ───────────────────────────────────────────────
echo "Creating snapshot..."
SNAPSHOT_RESPONSE=$(hetzner POST "/servers/$SERVER_ID/actions/create_image" -d "{
  \"type\": \"snapshot\",
  \"description\": \"$SNAPSHOT_DESCRIPTION\"
}")

IMAGE_ID=$(echo "$SNAPSHOT_RESPONSE" | jq -r '.image.id')
ACTION_ID=$(echo "$SNAPSHOT_RESPONSE" | jq -r '.action.id')

if [ -z "$IMAGE_ID" ] || [ "$IMAGE_ID" = "null" ]; then
  echo "ERROR: Failed to create snapshot"
  echo "$SNAPSHOT_RESPONSE" | jq . 2>/dev/null || echo "$SNAPSHOT_RESPONSE"
  exit 1
fi

echo "Snapshot creation started: image_id=$IMAGE_ID action_id=$ACTION_ID"

# Wait for snapshot to complete
for i in $(seq 1 60); do
  ACTION_STATUS=$(hetzner GET "/actions/$ACTION_ID" | jq -r '.action.status')
  if [ "$ACTION_STATUS" = "success" ]; then
    echo "Snapshot is ready."
    break
  fi
  if [ "$ACTION_STATUS" = "error" ]; then
    echo "ERROR: Snapshot creation failed"
    hetzner GET "/actions/$ACTION_ID" | jq .
    exit 1
  fi
  if [ "$i" -eq 60 ]; then
    echo "ERROR: Snapshot creation timed out after 5 minutes"
    exit 1
  fi
  sleep 5
done

# ─── Step 6: Done ──────────────────────────────────────────────────────────
echo ""
echo "==========================================="
echo "  Snapshot ID: $IMAGE_ID"
echo "  Description: $SNAPSHOT_DESCRIPTION"
echo "==========================================="
echo ""
echo "Add this to your .env:"
echo "  HETZNER_SNAPSHOT_ID=$IMAGE_ID"

if ! append_snapshot_release_notes; then
  echo "WARNING: Failed to append release notes entry to $RELEASE_NOTES_FILE"
fi

# The EXIT trap will delete the temporary server
