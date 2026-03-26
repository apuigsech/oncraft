# [ProductName]

> A visual Kanban workflow for managing Claude Code sessions.

[ProductName] is a desktop application that turns your Claude Code sessions into a structured, visual workflow. Each Kanban card maps to a Claude Code conversation, and cards move through configurable stages — from brainstorming to implementation to review.

<!-- TODO: Add screenshots -->

## Features

- **Kanban Board** — Organize Claude Code sessions as cards across workflow stages
- **Integrated Chat** — Rich chat interface with markdown rendering, tool approval, image attachments, and thinking blocks
- **Console Mode** — Full embedded terminal running Claude CLI directly
- **Flow System** — Configurable workflows with per-stage prompts, required files, and agent settings
- **Git Worktrees** — Isolate each card's work in its own git worktree
- **GitHub Integration** — Create cards from issues, link issues to cards, auto-close on completion
- **Cost Tracking** — Per-card and per-project cost and token usage metrics
- **Multi-Project** — Work across multiple repositories with tabbed navigation

## System Requirements

- **macOS** 12+ (ARM or Intel), **Windows** 10+, or **Linux** (AppImage)
- **Claude CLI** installed and configured with an API key
- **Git** (for worktree and branch features)
- **gh CLI** (optional, for GitHub integration)

## Installation

Download the latest release for your platform:

<!-- TODO: Add download links when domain/name are finalized -->

- macOS: `.dmg`
- Windows: `.msi`
- Linux: `.AppImage`

## Quick Start

1. Download and install [ProductName] for your platform
2. On first launch, the onboarding wizard will check your prerequisites
3. Open a project folder (any git repository)
4. Create a card in the Brainstorm column to start a new Claude Code session
5. Click the card to open the chat and start working

## Development

```bash
# Install frontend dependencies
pnpm install

# Build the sidecar binary (required before Tauri dev/build)
pnpm build:sidecar

# Run the full desktop app in development mode
pnpm tauri dev

# Run tests
pnpm test

# Build for production
pnpm tauri build
```

## License

Licensed under the [Functional Source License, Version 1.1 (FSL-1.1-Apache-2.0)](LICENSE).

You are free to use, modify, and distribute this software for any purpose except competing with the software or its creator's products. After the change date (specified per version), the license converts to Apache 2.0.

See the [LICENSE](LICENSE) file for full terms.
