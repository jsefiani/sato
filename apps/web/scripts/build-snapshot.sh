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

if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

OPENCLAW_VERSION="${1:-2026.2.9}"
HETZNER_API="https://api.hetzner.cloud/v1"
SERVER_TYPE="cpx22"
LOCATION="nbg1"
IMAGE="ubuntu-24.04"
SNAPSHOT_DESCRIPTION="sato-openclaw-${OPENCLAW_VERSION}"
SSH_PRIVATE_KEY_PATH="${SSH_PRIVATE_KEY_PATH:-${HETZNER_SSH_PRIVATE_KEY_PATH:-}}"

: "${HETZNER_API_TOKEN:?Missing HETZNER_API_TOKEN}"
: "${HETZNER_SSH_KEY_ID:?Missing HETZNER_SSH_KEY_ID}"
: "${SSH_PRIVATE_KEY_PATH:?Missing SSH_PRIVATE_KEY_PATH (set HETZNER_SSH_PRIVATE_KEY_PATH in .env)}"

hetzner() {
  local method="$1" path="$2"
  shift 2
  curl -sf -X "$method" \
    -H "Authorization: Bearer $HETZNER_API_TOKEN" \
    -H "Content-Type: application/json" \
    "${HETZNER_API}${path}" "$@"
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

ssh $SSH_OPTS "root@$SERVER_IP" bash -s -- "$OPENCLAW_VERSION" << 'REMOTE_SCRIPT'
set -euo pipefail
OPENCLAW_VERSION="$1"

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
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 18789/tcp
ufw allow in on tailscale0 to any port 22 proto tcp
ufw --force enable

# Enable fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# Create unprivileged openclaw user
useradd --system --shell /usr/sbin/nologin --home-dir /opt/openclaw --create-home openclaw

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

# Reset cloud-init fully (including seed dir) so it re-runs with new user_data
cloud-init clean --logs --seed

echo "Snapshot preparation complete."
REMOTE_SCRIPT

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

# The EXIT trap will delete the temporary server
