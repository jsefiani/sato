# VPS Snapshot Release Notes

This file tracks Hetzner snapshot builds for Sato user VPSes.

## 2026-02-19 - Snapshot 359824134

- Snapshot ID: `359824134`
- Description: `sato-openclaw-2026.2.9`
- OpenClaw version: `2026.2.9`
- Base image: `ubuntu-24.04`
- Builder profile: `cpx22` in `nbg1`
- Gateway/network defaults in snapshot:
  - UFW deny incoming by default
  - allow `tailscale0` TCP 22
  - allow `tailscale0` TCP 18789
  - public SSH debug mode: `false`
- Built at (UTC): `2026-02-19T22:15:32Z`
- Notes:
  - First snapshot entry recorded manually after enabling release-note tracking.

## 2026-02-20 - Snapshot 360129714

- Snapshot ID: `360129714`
- Description: `sato-openclaw-2026.2.9`
- OpenClaw version: `2026.2.9`
- Base image: `ubuntu-24.04`
- Builder profile: `cpx22` in `nbg1`
- Gateway/network defaults in snapshot:
  - UFW deny incoming by default
  - allow `tailscale0` TCP 22
  - allow `tailscale0` TCP 18789
  - public SSH debug mode: `false`
- Built at (UTC): `2026-02-20T22:25:40Z`
- Notes:
  - Snapshot prepared for loopback OpenClaw gateway access with Tailscale control-plane routing.
