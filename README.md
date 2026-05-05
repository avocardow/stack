# stack

A TanStack Start template, scaffolded with deliberate choices for full-stack web apps deployed to Cloudflare Workers. Convex for data, Better Auth for sessions, Sentry + PostHog for observability, Sandcastle for unattended agent runs.

This is the *starting point* for new projects, not a finished application.

---

## What's included

| Layer | Choice |
|---|---|
| Framework | TanStack Start (RC) on Vite v8 |
| Language | TypeScript v6, React 19 |
| Runtime | Node.js 22 (host), Cloudflare Workers (production) |
| Package manager | pnpm 10.14.0 (pinned via `packageManager`) |
| UI | Tailwind CSS v4 + shadcn (Radix primitives) |
| Database | Convex |
| Auth | Better Auth |
| State / data | TanStack Query, Form, Table, Store, Router |
| Testing | Vitest + Testing Library + jest-dom |
| Lint / format | Biome via Ultracite preset |
| Observability | Sentry + PostHog |
| Schema validation | Zod v4 |
| Env vars | t3-env |
| TS hygiene | `@total-typescript/ts-reset` |
| Agent orchestration | Sandcastle 0.5.7 (`.sandcastle/`) |
| CI | GitHub Actions |

For agent-readable project guidance, see [`AGENTS.md`](./AGENTS.md).

---

## First run

### 1. Clone and install

```bash
gh repo create my-project --template avocardow/stack --clone
cd my-project
pnpm install
```

### 2. Configure environment

Copy the env example:

```bash
cp .env.example .env.local
```

Fill in `.env.local` with real values. At minimum:

- `VITE_CONVEX_URL` and `CONVEX_DEPLOYMENT` (run `pnpm dlx convex init` to set automatically)
- `BETTER_AUTH_SECRET` (run `pnpm dlx @better-auth/cli secret` to generate)

Optional but recommended:

- `VITE_POSTHOG_KEY` for analytics
- `VITE_SENTRY_DSN` and `SENTRY_DSN` for error tracking

The dev server will fail to render any route without `VITE_CONVEX_URL` set — this is intentional fail-fast behaviour, not a bug.

### 3. Start Convex

In a separate terminal:

```bash
pnpm dlx convex dev
```

This starts the Convex backend and watches `convex/` for changes.

### 4. Start the dev server

```bash
pnpm dev
```

App runs at http://localhost:3000.

---

## Daily commands

```bash
pnpm dev          # Start dev server (requires .env.local + convex dev running)
pnpm test         # Run Vitest in run-once mode
pnpm typecheck    # Run TypeScript compiler in check-only mode
pnpm check        # Run Ultracite (Biome) lint + format check
pnpm fix          # Auto-fix lint and format issues
pnpm build        # Production build (outputs to .output/)
pnpm preview      # Preview the production build locally
pnpm deploy       # Build and deploy to Cloudflare Workers
```

A passing `pnpm check && pnpm typecheck && pnpm test` is the minimum bar before committing.

---

## Deploy to Cloudflare Workers

Production runs on Cloudflare Workers via the Cloudflare Vite plugin and `wrangler.jsonc`.

### One-time setup

```bash
pnpm add -g wrangler
wrangler login
```

### Set production secrets

For each secret in `.env.example`, set it in Cloudflare:

```bash
wrangler secret put VITE_CONVEX_URL
wrangler secret put BETTER_AUTH_SECRET
# etc.
```

Public (non-secret) vars go in `wrangler.jsonc` under `vars`.

### Deploy

```bash
pnpm deploy
```

This runs `pnpm build` then `wrangler deploy`. The build embeds `instrument.server.mjs` for SSR Sentry, then ships the bundle to Workers.

KV, D1, R2, and Durable Object bindings are configured in `wrangler.jsonc` if needed — see the [Cloudflare Workers configuration docs](https://developers.cloudflare.com/workers/wrangler/configuration/). This template uses Convex for all persistence by default; add Cloudflare bindings only if you have a specific reason.

---

## Adding shadcn components

```bash
pnpm dlx shadcn@latest add button
```

Components land in `src/components/ui/` as editable files (not dependencies).

---

## Sandcastle (unattended agent runs)

The `.sandcastle/` directory configures [Sandcastle](https://github.com/mattpocock/sandcastle), an AI agent orchestrator that runs Claude Code inside Docker containers against a backlog of GitHub Issues.

### Setup (per project)

1. Build the Docker image:
   ```bash
   sandcastle docker build-image
   ```
2. Copy the env example and fill in tokens:
   ```bash
   cp .sandcastle/.env.example .sandcastle/.env
   ```
   - `CLAUDE_CODE_OAUTH_TOKEN` — generate via `claude setup-token` (uses your Claude subscription, not API credits)
   - `GH_TOKEN` — copy from `gh auth token` or generate at https://github.com/settings/tokens (scope: `repo`)

3. Label issues you want the agent to work on with `Sandcastle`.

4. Run:
   ```bash
   npx tsx .sandcastle/main.ts
   ```

### What's pre-configured

This template ships Sandcastle with several non-default decisions baked in:

- **OAuth-token auth** instead of API key (uses your Claude subscription)
- **Default model: `claude-opus-4-7`** (override via `agent: claudeCode("...")` in `main.ts`)
- **macOS-friendly Dockerfile** (`chmod -R 0777 /home/agent` to handle host UID ≠ image UID; `~/.claude/` pre-seed for [anthropics/claude-code#8938](https://github.com/anthropics/claude-code/issues/8938))
- **5-minute install hook timeout** (Sandcastle's 60s default isn't enough for `pnpm install` on macOS Docker bind mounts)
- **No `copyToWorktree: ["node_modules"]`** — host pnpm node_modules can't be reused in the Linux container due to architecture mismatch; we install fresh in the container instead
- **GitHub Issues** as the backlog manager (filtered by the `Sandcastle` label)
- **Two prompts**: `prompt.md` (full RALPH workflow for real runs) and `prompt.smoke.md` (simple sanity-check prompt)

See [`AGENTS.md`](./AGENTS.md#sandcastle-agent-orchestration) for more detail.

---

## Project structure

```
src/
├── routes/                 # File-based routes (TanStack Router generates routeTree.gen.ts)
│   └── __root.tsx          # Root layout, providers, devtools
├── integrations/           # External service wiring (Convex, TanStack Query, Sentry)
├── components/             # UI components (shadcn lives in components/ui/)
├── lib/                    # Pure utilities
├── styles.css              # Tailwind v4 entrypoint + theme tokens
└── router.tsx              # Router instance + SSR Query integration

convex/                     # Convex schema, queries, mutations, actions
.sandcastle/                # Sandcastle agent orchestration config
.github/workflows/ci.yml    # Lint, typecheck, test, build on every PR
```

Files prefixed with `demo` can be safely deleted — they exist as a starting point for new projects.

---

## A note on the Vite / Vitest config split

This template has **two Vite configs**:

- `vite.config.ts` — for build, dev, and deploy (includes the Cloudflare plugin)
- `vitest.config.ts` — for tests (deliberately excludes the Cloudflare plugin)

This is intentional: the Cloudflare Vite plugin and Vitest fight over the SSR environment configuration. They can't share a single config without errors. Don't try to merge them back into one.

---

## Learn more

- [TanStack Start docs](https://tanstack.com/start)
- [TanStack Router docs](https://tanstack.com/router)
- [Convex docs](https://docs.convex.dev)
- [Better Auth docs](https://www.better-auth.com)
- [Cloudflare Workers docs](https://developers.cloudflare.com/workers/)
- [Tailwind CSS v4 docs](https://tailwindcss.com/docs/v4-beta)
- [shadcn docs](https://ui.shadcn.com)
- [Biome docs](https://biomejs.dev)
- [Sandcastle](https://github.com/mattpocock/sandcastle)

For project-specific conventions and guidance for AI agents, see [`AGENTS.md`](./AGENTS.md).