---
topic: product
description: Core value props, agent-agnostic architecture, key differentiators, product surfaces
consumers: strategist, creator-evaluate, creator-integrate, creator-execute
priority: 2
---

## Core value props

- **Agent-agnostic**: Claude Code, OpenCode, more coming
- **Your API key stays yours**: Grass never touches it
- **Mobile-first control**: Monitor, steer, approve, and push — all from your phone
- **Session persistence**: Sessions survive disconnects; reconnect picks up where you left off
- **Permission forwarding**: Approve/deny tool executions (bash, file writes) remotely from a native modal

## Two surfaces

1. **Cloud VM product** (codeongrass.com) — a remote VM environment for running AI coding agents 24/7. Pre-configured Daytona VMs. Monitor agent progress from your phone, intervene mid-session, push changes without touching your computer. Free tier: 10 hours, no credit card.

2. **Local CLI** (`@grass-ai/ide`, open-source MIT) — run `grass start`, scan a QR code, and control a Claude agent session from your phone while it works in your local project directory. No cloud relay — direct WiFi connection. Sessions survive disconnects, permission prompts forward to your phone, full diff viewer.

## Mobile app (grass-expo, open-source MIT)

Native iOS app (React Native / Expo) for connecting to any Grass server — QR scan connect, multi-server management, real-time streaming chat, diff viewer, permission request modals, auto-reconnect.
