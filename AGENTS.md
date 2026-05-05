# AGENTS.md

Guidance for AI agents (and humans) working in this repository. Read this before making non-trivial changes.

---

## What this project is

A TanStack Start template — the starting point for new web apps. The stack is intentionally specific and the choices are deliberate. Don't propose swapping framework, runtime, database, auth, or deploy target without an explicit instruction to do so.

The template is meant to be cloned via `gh repo create new-project --template avocardow/stack`, then configured per-project. It is *not* meant to be a finished application.

---

## Stack at a glance

| Layer | Choice | Why |
|---|---|---|
| Framework | TanStack Start (RC) on Vite v8 | File-based routing + SSR + first-class TanStack Router/Query integration |
| Language | TypeScript v6 | Strict mode is on; treat type errors as bugs |
| Runtime | Node.js 22 (host), Cloudflare Workers (production) | Workers-compatible code only |
| Package manager | pnpm 10.14.0 | Pinned via `packageManager` field with SHA integrity hash; do not switch to npm/yarn/bun |
| UI | React 19 + Tailwind CSS v4 + shadcn (Radix primitives) | Tailwind v4 uses CSS-first config in `src/styles.css`, not `tailwind.config.js` |
| Database | Convex | Real-time, type-safe, serverless. Never use SQL or write to a different database |
| Auth | Better Auth | Session-based, integrates with Convex. Never roll custom JWT or OAuth flows |
| Forms | TanStack Form | Use this for any non-trivial form, even if `<form>` would work |
| Tables | TanStack Table | For any tabular data display |
| State | TanStack Store (alpha) | Used deliberately even though Zustand is more mature |
| Testing | Vitest + Testing Library + jest-dom matchers | See "Testing" section for the config split |
| Lint/Format | Biome via Ultracite preset | Run `pnpm fix` to auto-fix; `pnpm check` to verify |
| Observability | Sentry (errors) + PostHog (analytics) | Server-side Sentry uses `instrument.server.mjs` |
| Schema | Zod v4 | Standard Schema compatible. Use for runtime validation, env parsing, form schemas |
| Env vars | t3-env | All environment variables go through `src/env.ts` (or equivalent) — never use `process.env` directly |
| TS hygiene | `@total-typescript/ts-reset` | Wired via `reset.d.ts` at the project root |
| Agent orchestration | Sandcastle 0.5.7 (in `.sandcastle/`) | For unattended AFK runs against GitHub Issues |
| CI | GitHub Actions | Plain workflow at `.github/workflows/ci.yml` |

---

## Verification commands

Before committing any change, run the relevant subset of these:

| What | Command | When |
|---|---|---|
| Type check | `pnpm typecheck` | Any code change |
| Lint | `pnpm lint` | Any code change |
| Format | `pnpm format` | Any code change (or `pnpm fix` to auto-fix) |
| Combined check | `pnpm check` | Pre-commit (runs Ultracite's full suite) |
| Unit tests | `pnpm test` | Logic changes, component changes, refactors |
| Dev server | `pnpm dev` | Manual verification (requires `.env.local` configured) |
| Production build | `pnpm build` | Pre-deploy or pre-PR for non-trivial changes |
| Auto-fix everything | `pnpm fix` | Whenever lint/format errors appear |

A passing `pnpm check && pnpm typecheck && pnpm test` is the minimum bar before committing.

---

## Project structure

```
src/
├── routes/                 # TanStack Router file-based routes
│   ├── __root.tsx          # Root layout, providers, devtools
│   └── index.tsx           # Home route
├── integrations/           # External service wiring
│   ├── convex/             # Convex provider, hooks
│   ├── tanstack-query/     # Query client, root provider, devtools
│   └── sentry/             # Sentry initialisation
├── components/             # Reusable UI components (shadcn lives in `components/ui/`)
├── lib/                    # Pure utilities, helpers
├── styles.css              # Tailwind v4 entrypoint + theme tokens
└── router.tsx              # Router instance + SSR Query integration

convex/                     # Convex schema, queries, mutations, actions
.sandcastle/                # Sandcastle agent config (see "Sandcastle" below)
.github/workflows/          # CI
instrument.server.mjs       # Sentry SSR initialisation (loaded via NODE_OPTIONS)
reset.d.ts                  # TS reset import (do not delete)
vite.config.ts              # Build/deploy config (with Cloudflare plugin)
vitest.config.ts            # Test config (deliberately separate from vite.config.ts — see Testing)
```

When adding a new feature, follow this layout. Routes go in `src/routes/`, integrations go in `src/integrations/<service>/`, shared utilities go in `src/lib/`. Don't create new top-level directories without strong justification.

---

## Stack-specific guidance

### Convex (database)

- **Never write SQL or use an ORM.** All data goes through Convex queries, mutations, and actions in the `convex/` directory.
- Database schema is defined in `convex/schema.ts` using Convex's schema builder, not Prisma/Drizzle/SQL.
- Use `useQuery` / `useMutation` from `convex/react` in components, not raw fetch calls.
- Convex actions can use Node.js APIs only when prefixed with the `"use node"` directive at the top of the file. Convex queries and mutations cannot.
- The `VITE_CONVEX_URL` env var is required for the dev server to render any route. SSR will 500 without it. This is intentional fail-fast behaviour, not a bug.
- For real-time subscriptions, prefer Convex's reactive queries over manual polling.

### Better Auth

- **Don't roll custom auth.** No JWT signing, no manual session handling, no OAuth client code.
- Better Auth is wired to Convex for session storage. Authentication state flows through Convex's reactive queries.
- Sign-in/sign-up flows use Better Auth's pre-built handlers; customise via Better Auth's config, not by replacing the handlers.

### TanStack Router / Start

- Routes are file-based. Adding a new route means adding a file in `src/routes/`. The `routeTree.gen.ts` file is *generated* — never edit it manually.
- Use `<Link>` from `@tanstack/react-router` for in-app navigation, not `<a>`. Hard-coding `<a href>` breaks client-side routing.
- Loaders run on both server and client. Don't use Node-only APIs in loaders unless guarded.
- Server functions (created with `createServerFn`) run on the server only. Use these for sensitive logic or data access that shouldn't ship to the client.
- The router context flows through TanStack Query and Convex providers. Don't reach for Context providers when the router context can carry the value.

### Cloudflare Workers (deploy target)

- Production runs on Cloudflare Workers, not Node. **Avoid Node-only APIs** in code paths that ship to production unless you've verified Cloudflare compatibility.
- Common foot-guns: `fs`, `child_process`, `crypto` (use `crypto.subtle` instead), node-style streams, `process.env` in client bundles.
- The Vite Cloudflare plugin runs only during `vite build` and `vite dev`. Tests run in JSDOM, so test-time code can use Node APIs freely — but if a Node API leaks into a production code path, it'll fail at deploy time.
- The `wrangler.jsonc` file configures the Workers deployment. Don't add bindings (KV, R2, D1) without explicit instruction; this template uses Convex for all persistence.

### Tailwind v4 + shadcn

- Tailwind v4 uses **CSS-first config**. Theme tokens (colors, fonts, spacing) are defined in `src/styles.css` via `@theme`, not in a JS config file.
- shadcn components live in `src/components/ui/`. They are *copied in* (not installed as a dependency), so editing them directly is fine.
- Add new shadcn components via `pnpm dlx shadcn@latest add <component>` — don't hand-write them.
- Animations come via `tw-animate-css` (already wired). Don't add Framer Motion, GSAP, or other animation libraries without explicit instruction.

### Sentry + PostHog

- Sentry is initialised in two places: `instrument.client.ts` (browser) and `instrument.server.mjs` (SSR). The server initialisation runs via `NODE_OPTIONS=--import` in the `dev` and `start` scripts.
- Don't add `Sentry.captureException` calls everywhere. Sentry's automatic instrumentation catches most things; only call manually for genuinely interesting errors that wouldn't otherwise be reported.
- PostHog is for product analytics. Use `posthog.capture('event_name', { props })` for user actions worth tracking. Don't capture PII without explicit user consent.
- Both Sentry and PostHog DSNs are optional at build time but required for the observability features to work in production.

### Forms (TanStack Form + Zod)

- All non-trivial forms use TanStack Form with Zod schemas for validation.
- Define the Zod schema first, derive types from it (`type Form = z.infer<typeof schema>`), then wire to TanStack Form. Don't define types separately.
- For simple inputs (single-field newsletter sign-up etc.), a plain `<form>` is fine. The threshold is ~3 fields or any cross-field validation.

### Environment variables

- All env vars go through t3-env. Define schemas in the env config file; access via the typed `env` export. Never use `process.env.SOMETHING` directly.
- Client-side env vars must be prefixed `VITE_` to be exposed to the browser bundle. Anything else is server-only.
- `.env.local` is gitignored. Real values live there per project. The dev server requires `VITE_CONVEX_URL` to be set (loaded via `dotenv -e .env.local` in the `dev` script).

---

## Testing

The test setup has one important quirk worth understanding: **there are two separate Vite configs**.

- **`vite.config.ts`** — for build, dev, and deploy. Includes the Cloudflare Vite plugin.
- **`vitest.config.ts`** — for running tests. Does *not* include the Cloudflare plugin.

Why: the Cloudflare Vite plugin asserts that the `ssr` environment must not externalise Node.js builtins. Vitest, by default, externalises all Node builtins for the SSR environment (because Vitest itself runs in Node). The two assertions conflict. Sharing a single config means tests fail to start with a "resolve.external" error.

The split is deliberate. Don't try to "simplify" it back to one config.

### Test conventions

- Tests live colocated with source: `Button.tsx` → `Button.test.tsx`. Or in `src/test/` for cross-cutting tests.
- Use Testing Library for component tests, not Enzyme.
- jest-dom matchers (`toBeInTheDocument()`, `toBeVisible()`, etc.) are available — they're imported via `src/test/setup.ts`. Despite the name, they work fine with Vitest; this is *not* Jest.
- Write assertions inside `it()` or `test()` blocks. No bare `expect()` at the top level.
- Avoid `.only` or `.skip` in committed code.
- Don't nest `describe` blocks more than 2 deep.

---

## Sandcastle (agent orchestration)

The `.sandcastle/` directory configures Sandcastle, an AI agent orchestrator that runs Claude Code inside Docker containers for unattended work.

You probably don't need to interact with `.sandcastle/` unless explicitly working on agent orchestration. Things to know if you do:

- **Auth**: This project uses `CLAUDE_CODE_OAUTH_TOKEN` (Claude subscription) rather than `ANTHROPIC_API_KEY`. The token lives in `.sandcastle/.env` (gitignored).
- **Default model**: `claude-opus-4-7`. Override per-run via `agent: claudeCode("...")` in `.sandcastle/main.ts`.
- **Default prompt**: `.sandcastle/prompt.md` (the RALPH workflow — autonomous issue iteration).
- **Smoke test prompt**: `.sandcastle/prompt.smoke.md` (simple task for sanity-checking the pipeline).
- **Backlog manager**: GitHub Issues, filtered by the `Sandcastle` label.
- **Run command**: `npx tsx .sandcastle/main.ts`
- **macOS-specific Dockerfile fixes are baked in**: `chmod -R 0777 /home/agent` (UID mismatch between host and container), corepack pre-activation (avoids runtime pnpm download), `~/.claude/` pre-seed (workaround for anthropics/claude-code#8938).
- **The install hook timeout is 5 minutes** (300000ms), not Sandcastle's 60s default. macOS Docker bind-mount performance plus pnpm's full reinstall (host vs container architecture mismatch) needs the headroom.

---

## CI

`.github/workflows/ci.yml` runs on every push and PR to `main`:

1. Checkout
2. Install pnpm + Node 22
3. `pnpm install --frozen-lockfile`
4. `pnpm check` (lint + format)
5. `pnpm typecheck`
6. `pnpm test`
7. `pnpm build`

The build step uses placeholder Convex env vars (`VITE_CONVEX_URL=https://placeholder.convex.cloud`) — the build only needs the env var to be *set*, not to point at a real backend. Per-project deploy CI should override these.

---

## Code style (Ultracite-enforced)

Ultracite is a Biome preset that enforces strict standards. Most issues are auto-fixable: run `pnpm fix` to address them. The rules below are the principles behind the automation — useful when Biome flags something and you need to understand why.

### Type safety

- Use explicit types for function parameters and return values when they enhance clarity.
- Prefer `unknown` over `any`. When you need `any`, leave a comment explaining why.
- Use `as const` for immutable values and literal types.
- Lean on TypeScript's narrowing instead of type assertions (`as Foo`). If you find yourself using `as`, consider whether a narrowing function or zod parse would be safer.
- Use meaningful constants, not magic numbers.

### Modern JS/TS

- Arrow functions for callbacks and short functions.
- `for...of` over `.forEach()` and indexed `for` loops.
- Optional chaining (`?.`) and nullish coalescing (`??`) for safer property access.
- Template literals over string concatenation.
- Destructuring for object and array assignments.
- `const` by default, `let` only when reassignment is needed, never `var`.

### Async

- Always `await` promises in async functions.
- `async/await` over promise chains.
- Handle errors with `try/catch`, not `.catch()` chains.
- Don't use async functions as Promise executors.

### React

- Function components only. No class components.
- Hooks at the top level, never conditional.
- Specify all dependencies in hook dependency arrays correctly. If `pnpm check` flags a missing dep, fix it — don't disable the rule.
- Use `key` prop with stable unique IDs (not array indices) for iterables.
- Don't define components inside other components.
- Use semantic HTML and ARIA attributes:
  - Meaningful alt text for images.
  - Proper heading hierarchy.
  - Labels for form inputs.
  - Keyboard event handlers alongside mouse events.
  - Semantic elements (`<button>`, `<nav>`) over `<div>` with role.
- React 19 conventions: use `ref` as a prop, not `forwardRef`.

### Errors

- No `console.log`, `debugger`, or `alert` in committed code (Biome will catch these).
- Throw `Error` objects with descriptive messages, not strings.
- Use `try/catch` meaningfully — don't catch just to rethrow.
- Prefer early returns over nested conditionals.

### Code organisation

- Keep functions focused and under reasonable cognitive complexity.
- Extract complex conditions into named boolean variables.
- Use early returns to reduce nesting.
- Prefer simple conditionals over nested ternaries.

### Security

- `rel="noopener"` (or `noreferrer`) when using `target="_blank"`.
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary; sanitise input first.
- No `eval()`, no direct `document.cookie` writes.
- Validate user input at boundaries (use Zod schemas).

### Performance

- Don't spread into accumulators inside loops.
- Top-level regex literals, not in-loop construction.
- Specific imports over namespace imports.
- Avoid barrel files (re-export indexes). They defeat tree-shaking.

---

## What Biome can't help with

Biome catches most issues automatically. Focus your judgement on:

1. **Business logic correctness** — Biome can't validate algorithms.
2. **Meaningful naming** — Use descriptive names for functions, variables, and types.
3. **Architecture decisions** — Component structure, data flow, API design.
4. **Edge cases** — Handle boundary conditions and error states.
5. **User experience** — Accessibility, performance, usability.
6. **Documentation** — Comments for complex logic; prefer self-documenting code.

---

## Commits

- One logical change per commit.
- Commit message format: imperative mood, present tense (`Add user profile route`, not `Added` or `Adds`).
- For larger changes, write a body explaining *why*, not *what* (the diff shows what).
- Don't commit `.env.local`, `.sandcastle/.env`, or anything in `.sandcastle/logs/` or `.sandcastle/worktrees/` — these are gitignored.
- Sandcastle agent commits are prefixed with `RALPH:` (configured in `.sandcastle/prompt.md`). Don't replicate this prefix for human/manual commits.

---

## When in doubt

- **Adding a dependency**: pause and ask. Most additions are wrong; the stack is deliberate. If the answer is "yes," use `pnpm add <pkg>` (devDeps with `-D`).
- **Changing build config**: pause and ask. The Vite/Vitest config split, the dotenv wrapping in `dev`, the Sentry instrument loading — these have non-obvious reasons.
- **Disabling a Biome rule**: pause and ask. The rules exist for reasons; disabling is the last resort.
- **Replacing a stack choice**: pause and ask. Convex/Better Auth/Cloudflare/TanStack are deliberate.
- **Anything that affects production runtime**: pause and ask, especially anything that introduces Node-only APIs.

When you pause, leave a comment in the issue or PR explaining what you almost did and what you'd want clarified.