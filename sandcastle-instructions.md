# Sandcastle setup — end-to-end

End-to-end setup for [Sandcastle](https://github.com/mattpocock/sandcastle) 0.5.7 wired for: Claude Max OAuth-token auth (not API key), pnpm (not npm), Opus 4.7, macOS host. Captures the gotchas discovered while wiring the `avocardow/stack` template.

If your stack uses npm/yarn/bun, swap the package manager bits. Everything else (auth, Dockerfile UID workaround, hook timeout) applies identically.

---

## Prerequisites

| Tool | Why | Verify |
|---|---|---|
| Docker Desktop, running | Sandcastle uses Docker for sandbox containers | `docker info` |
| `gh` CLI, authenticated | Backlog and issue management | `gh auth status` |
| Sandcastle CLI | The orchestrator | `sandcastle --version` (should be 0.5.7+) |
| `claude` CLI | Generate OAuth token | `claude --version` |
| Active Claude Max subscription | OAuth-token auth uses subscription billing, not API credits | — |

Install Sandcastle once globally if you haven't: `npm i -g @ai-hero/sandcastle` (or `brew install`/equivalent).

---

## Step 1 — Initial scaffold

From inside your project's repo root:

```bash
sandcastle init
```

This creates `.sandcastle/` with:
- `Dockerfile` — base node:22-bookworm + git + gh + Claude Code CLI
- `main.ts` — orchestrator entry point
- `prompt.md` — default agent prompt (RALPH-shaped — autonomous issue iteration)
- `.env.example` — env template
- `.gitignore` — excludes `.env`, `logs/`, `worktrees/`

Also create the GitHub label Sandcastle filters by:

```bash
gh label create Sandcastle --description "Picked up by Sandcastle agent runs" --color BFD4F2
```

---

## Step 2 — Customize the Dockerfile

Replace `.sandcastle/Dockerfile` with the version below. Three custom additions vs the default scaffold, all **load-bearing on macOS**:

```dockerfile
FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \
  git \
  curl \
  jq \
  && rm -rf /var/lib/apt/lists/*

# Enable corepack so pnpm is available, version-pinned via the
# packageManager field in package.json. Runs as root before USER switch.
RUN corepack enable

# Pre-activate pnpm at the version pinned by package.json's packageManager field.
# NOTE: this caches under /root/.cache/... so the agent user (UID 1000) still
# downloads pnpm at runtime. The 5-min install-hook timeout absorbs it.
# To fully eliminate the runtime download, move this line to AFTER `USER agent`.
RUN corepack prepare pnpm@10.14.0 --activate

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# Rename the base image's "node" user (UID 1000) to "agent".
# This keeps UID 1000 so that --userns=keep-id (Podman) and
# --user 1000:1000 (Docker) map to the correct home directory owner.
RUN usermod -d /home/agent -m -l agent node
USER agent

# Pre-seed minimal ~/.claude/ config so that CLAUDE_CODE_OAUTH_TOKEN auth works
# in fresh containers without the CLI walking through interactive setup.
# Workaround for anthropics/claude-code#8938.
RUN mkdir -p /home/agent/.claude && \
    echo '{"hasCompletedOnboarding": true, "theme": "dark"}' > /home/agent/.claude/settings.json

# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash

# Add Claude to PATH
ENV PATH="/home/agent/.local/bin:$PATH"

# Make /home/agent writable to any UID, including the host UID Docker passes
# through on macOS (~501) which differs from the image's UID 1000. Placed last
# so it covers files the Claude Code installer wrote during build. Container
# is ephemeral and network-isolated; loose home perms are not a security risk.
RUN chmod -R 0777 /home/agent

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at /home/agent/workspace
# and overrides the working directory to /home/agent/workspace at container start.
ENTRYPOINT ["sleep", "infinity"]
```

### Why each custom addition matters

1. **`corepack enable` + `corepack prepare`** — enables pnpm. The `prepare` line is for layer-caching; see caveat in the comment. If you want zero runtime pnpm download, move both lines to *after* `USER agent` (cache lives under `/home/agent/.cache/...` then, which the chmod -R 0777 makes accessible).

2. **`~/.claude/settings.json` pre-seed** — without this, the Claude Code CLI walks through interactive setup on first invocation inside the container even when `CLAUDE_CODE_OAUTH_TOKEN` is set. Workaround for [anthropics/claude-code#8938](https://github.com/anthropics/claude-code/issues/8938).

3. **`chmod -R 0777 /home/agent`** — **the macOS-critical line**. See "Gotcha 1" below for the full diagnosis. Must be the **last `RUN`** before `WORKDIR`, after the Claude Code installer (which writes `~/.cache/`, `~/.local/`).

---

## Step 3 — Customize `main.ts`

Replace `.sandcastle/main.ts` with:

```typescript
import { claudeCode, run } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

// Run with: npx tsx .sandcastle/main.ts
// Or via package.json: "sandcastle": "npx tsx .sandcastle/main.ts"

await run({
  name: "worker",
  sandbox: docker(),

  // The agent provider. Pass a model string to claudeCode() — opus 4.7 is the
  // most capable model with a step-change in agentic coding over 4.6. Switch to
  // claude-sonnet-4-6 for cheaper/faster runs on simpler tasks, or
  // claude-haiku-4-5-20251001 for speed-first work. Note: 4.7 uses 1.0–1.35x
  // more tokens than 4.6 due to the new tokenizer; budget AFK runs accordingly.
  agent: claudeCode("claude-opus-4-7"),

  promptFile: "./.sandcastle/prompt.md",

  maxIterations: 3,

  // Required when copyToWorktree is used; harmless otherwise.
  branchStrategy: { type: "merge-to-head" },

  // Note: copyToWorktree: ["node_modules"] is intentionally NOT used here.
  // Host (macOS arm64) and container (linux) architectures differ, so any
  // copied node_modules would be detected as inconsistent by pnpm and
  // reinstalled from scratch — paying the copy cost for zero benefit.
  // Instead, pnpm install runs cleanly in the container.

  hooks: {
    sandbox: {
      // timeoutMs: 5 minutes — empirical measurement shows a fresh install in
      // the container takes ~62s; default 60s timeout cuts it off. 5x headroom
      // covers slow-network or store-cache-cold cases.
      onSandboxReady: [
        {
          command: "pnpm install --frozen-lockfile",
          timeoutMs: 300_000,
        },
      ],
    },
  },
});
```

### What's load-bearing here

- **`claudeCode("claude-opus-4-7")`** — uses your Claude subscription (because of OAuth-token auth set up in step 4) instead of API credits.
- **No `copyToWorktree: ["node_modules"]`** — see "Gotcha 2".
- **`timeoutMs: 300_000`** on the install hook — see "Gotcha 3".

If your project doesn't use pnpm, swap `pnpm install --frozen-lockfile` for `npm ci` / `yarn install --frozen-lockfile` / `bun install --frozen-lockfile`.

---

## Step 4 — Auth setup (`.sandcastle/.env`)

Replace `.sandcastle/.env.example` contents with:

```
# Claude Code OAuth token (sk-ant-oat01-...) — generated via `claude setup-token`.
# Authenticates against Claude Max subscription instead of API key billing.
# Treat as a password — anyone with this token can use the subscription.
CLAUDE_CODE_OAUTH_TOKEN=

# GitHub personal access token — used by `gh` CLI inside the container to
# read/write issues. Generate at https://github.com/settings/tokens with at
# minimum: repo, read:org. Or use `gh auth token` to copy the existing CLI token.
GH_TOKEN=
```

Then create the real `.env`:

```bash
cp .sandcastle/.env.example .sandcastle/.env
```

Generate the OAuth token (interactive — opens browser):

```bash
claude setup-token
```

Copy the output `sk-ant-oat01-...` into `.sandcastle/.env` after `CLAUDE_CODE_OAUTH_TOKEN=`.

For the GitHub token, the easiest path is reusing your `gh` CLI's token:

```bash
gh auth token
```

Copy the output into `.sandcastle/.env` after `GH_TOKEN=`.

### Verify (without revealing values)

```bash
grep -c "^CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-" .sandcastle/.env  # → 1
grep -c "^GH_TOKEN=." .sandcastle/.env                              # → 1
git check-ignore .sandcastle/.env                                   # → .sandcastle/.env
```

All three checks must pass. If `GH_TOKEN=.` returns 0, the value is empty — `gh issue list` will silently fail inside the container.

---

## Step 5 — Two prompts (recommended)

Keep two prompt files so you can sanity-check the pipeline without running real work.

### `.sandcastle/prompt.md` (default — RALPH workflow)

Use whatever prompt suits your real workflow. The default scaffold's RALPH prompt is a reasonable starting point for autonomous issue iteration. If your project uses pnpm, change the verify step from `npm run typecheck` / `npm run test` to `pnpm typecheck` / `pnpm test`.

### `.sandcastle/prompt.smoke.md` (smoke test)

Create this file:

```markdown
# Sandcastle smoke test

## Open issues with the Sandcastle label

!`gh issue list --state open --label Sandcastle --json number,title,body --limit 5`

# Task

This is a smoke test of the Sandcastle pipeline. There should be exactly one open GitHub issue labelled `Sandcastle` asking you to create a file. Read the issue, do exactly what it says, and nothing more.

## Workflow

1. **Read** the issue. Identify the file path and contents requested.
2. **Create** the file with the requested contents. Do not modify any other files.
3. **Commit** with a message in the format: `Smoke test: <one-line description of what you did>`. Do not use a `RALPH:` prefix.
4. **Close** the issue with: `gh issue close <ID> --comment "Smoke test complete — file created in commit <SHA>"` where `<SHA>` is the short hash of your commit.

## Rules

- This is intentionally a tiny task. Do not over-engineer. Do not run typecheck or tests — the changes don't touch any code that needs them.
- If there is no open Sandcastle-labelled issue, output the completion signal immediately without doing anything.
- If there is more than one Sandcastle-labelled issue, work on the lowest-numbered one only.

# Done

After closing the issue (or if there were no issues to close), output the completion signal:

<promise>COMPLETE</promise>
```

To run the smoke prompt instead of the default, temporarily change `promptFile` in `main.ts` to `"./.sandcastle/prompt.smoke.md"`, then change it back after the smoke test passes.

---

## Step 6 — Build the image

```bash
sandcastle docker build-image
```

**Note**: it's `sandcastle docker build-image`, **not** `sandcastle build-image` (which doesn't exist in 0.5.7). The CLI subcommand structure is `sandcastle <runtime> <command>`.

Verify:

```bash
docker image ls sandcastle:<your-image-tag>
```

The tag is auto-derived from the project directory name (e.g. `sandcastle:stack` for a project at `/Users/rowan/.../stack`).

### Pre-flight permission probe (macOS)

Before running for real, verify the chmod fix actually grants the host UID write access to all the dirs Claude Code touches:

```bash
docker run --rm \
  --user $(id -u):$(id -g) \
  -e HOME=/home/agent \
  --entrypoint sh \
  sandcastle:<your-image-tag> \
  -c 'touch /home/agent/.gitconfig && touch /home/agent/.cache/test && touch /home/agent/.local/test && echo all writes ok'
```

If you don't see `all writes ok`, the chmod placement in the Dockerfile is wrong (probably ran before the Claude Code installer wrote `.cache/` / `.local/`). Move the `RUN chmod -R 0777 /home/agent` line to be the **last** `RUN` before `WORKDIR`.

---

## Step 7 — Smoke test (end-to-end verification)

### Create a smoke-test issue

```bash
gh issue create \
  --title "Smoke test: create hello.txt" \
  --label Sandcastle \
  --body 'Create a file at the repo root named `hello.txt` with the exact contents:

```
Hello from Sandcastle
```

That is one line. Do not modify any other files.'
```

### Switch to smoke prompt and run

In `.sandcastle/main.ts`, temporarily change:
```typescript
promptFile: "./.sandcastle/prompt.md",
```
to:
```typescript
promptFile: "./.sandcastle/prompt.smoke.md",
```

Then run:

```bash
npx tsx .sandcastle/main.ts
```

Expected timing: **~3.5 minutes total** on macOS Docker:
- ~30s sandbox bring-up
- ~60–80s `pnpm install --frozen-lockfile`
- ~30–60s agent execution (small task, simple prompt)
- ~10s git ops (commit, merge-to-head, push)

### Verify success

```bash
ls hello.txt && cat hello.txt                                   # file present, correct contents
git log --oneline -5                                            # new "Smoke test: ..." commit on main
gh issue list --state closed --label Sandcastle --limit 1       # issue closed with agent's comment
```

All three should look right. If Sandcastle reports "Run succeeded but worktree has uncommitted changes", that's usually just a leftover `.pnpm-store/` directory — not actual agent work. Clean up with:

```bash
git worktree remove --force .sandcastle/worktrees/<worktree-name>
```

### Restore the real prompt

Change `main.ts` back:
```typescript
promptFile: "./.sandcastle/prompt.md",
```

Now you're set up. `npx tsx .sandcastle/main.ts` runs the real workflow against any open `Sandcastle`-labelled issues.

---

## Gotchas

### Gotcha 1 — `git config --global` permission denied (macOS only)

**Symptom**: First run dies almost immediately with:
```
ExecError: Command failed (exit 255):
git config --global --add safe.directory "/home/agent/workspace"
error: could not lock config file /home/agent/.gitconfig: Permission denied
```

**Cause**: Sandcastle 0.5.7 hardcodes `--user ${hostUid}:${hostGid}` (`docker.js:51`) with no override exposed via `docker()` options. On macOS your host UID is **501**, but the container image builds `/home/agent` owned by image UID **1000** (the renamed `node` user). UID 501 has no write access there, so `git config --global` can't create `~/.gitconfig`.

**Fix**: The `RUN chmod -R 0777 /home/agent` line in the Dockerfile (already in the template above). **Placement matters** — it must run after the Claude Code installer (which writes `~/.cache/`, `~/.local/`) so its created files are also covered. Last `RUN` before `WORKDIR`.

**Why this isn't a problem on Linux**: Linux host UID is typically 1000 (first non-root user), which happens to match the `node` base image's user UID. Pure historical convention — `--user $(id -u):$(id -g)` accidentally works.

**Why `chmod 0777` is fine here**: the container is ephemeral, network-isolated, and short-lived. Loose home perms inside a throwaway sandbox are not a security risk in the way they would be on a long-lived shared server.

### Gotcha 2 — `copyToWorktree: ["node_modules"]` is wasted on macOS

**Symptom**: `Copying to worktree done (30s)` log line, then `pnpm install` either hangs (asks to wipe-and-reinstall, which non-TTY can't answer) or wipes everything you just copied.

**Cause**: macOS host node_modules contains darwin-arm64 binaries. The Linux container needs linux-x86_64/arm64 binaries. pnpm sees the mismatch and wants to wipe-and-reinstall from scratch — the copy was wasted work.

**Fix**: Drop the `copyToWorktree: ["node_modules"]` line entirely (already done in the `main.ts` template above). pnpm will install fresh in the container; with the install-hook timeout bump (Gotcha 3), this works fine.

If your host happens to be Linux x86_64 and matches the container architecture, `copyToWorktree` *might* work — but it's a footgun for cross-team/cross-platform reproducibility. Just drop it.

### Gotcha 3 — Default 60s install-hook timeout is too short on Docker for Mac

**Symptom**:
```
HookTimeoutError: Hook 'pnpm install --frozen-lockfile' timed out after 60000ms
```

**Cause**: Docker Desktop on Mac uses a Linux VM and bind-mount filesystem performance is famously slow. Empirical measurement: a fresh `pnpm install --frozen-lockfile` for a ~50-package project takes **~62s** in the container — just barely over the 60s default.

**Fix**: Bump the hook timeout. The schema is `{ command: string, timeoutMs?: number }` (per `node_modules/@ai-hero/sandcastle/dist/SandboxLifecycle.d.ts`). Set `timeoutMs: 300_000` for ~5x headroom (already done in the `main.ts` template above).

Don't bypass this with `--no-frozen-lockfile` or by switching to a less-strict install — frozen-lockfile is doing real work catching consistency bugs early. Just give it the time.

### Gotcha 4 — `sandcastle build-image` doesn't exist

The CLI subcommand structure is `sandcastle <runtime> <command>`. The build subcommand lives under the runtime:

```bash
sandcastle docker build-image    # ✓ correct
sandcastle build-image           # ✗ "Invalid subcommand for sandcastle"
```

If you use Podman: `sandcastle podman build-image`.

### Gotcha 5 — `GH_TOKEN` empty silently breaks the smoke prompt

If `GH_TOKEN` is empty or missing in `.sandcastle/.env`, the `gh issue list ...` shell expression in the smoke prompt produces no output (gh fails or returns empty without auth). The agent then "correctly" concludes there are no issues to work on, signals COMPLETE, and you have no idea why nothing happened.

**Fix**: always run the verification grep checks in step 4 before assuming `.env` is good. The format check `grep -c "^GH_TOKEN=." .sandcastle/.env` returning `1` confirms the value isn't empty.

### Gotcha 6 — `corepack prepare` placement (polish issue)

The Dockerfile template above runs `RUN corepack prepare pnpm@... --activate` while still under `USER root` (before the `USER agent` switch). This caches the prepared pnpm under `/root/.cache/corepack/...` — which the agent user (UID 1000) and host UID 501 can't read. Result: pnpm is still re-downloaded at runtime on first invocation.

**Why I left it**: the 5-min hook timeout has plenty of headroom for the corepack download (~5–15s) plus the install (~62s), and the `prepare` line still adds documentation value (declares the version intent in the Dockerfile).

**To fully eliminate the runtime download**: move both `corepack enable` and `corepack prepare pnpm@... --activate` to **after** `USER agent`. They'll cache under `/home/agent/.cache/corepack/...`, and the `chmod -R 0777 /home/agent` later in the Dockerfile will keep that cache accessible to whoever Sandcastle runs as.

---

## Quick reference

### File checklist

```
.sandcastle/
├── Dockerfile          ← customized (corepack, ~/.claude pre-seed, chmod)
├── main.ts             ← customized (opus-4-7, no copyToWorktree, timeoutMs: 300_000)
├── prompt.md           ← real workflow (e.g. RALPH)
├── prompt.smoke.md     ← smoke test prompt (kept for future sanity checks)
├── .env.example        ← documents auth model (OAuth token + GH_TOKEN)
├── .env                ← real tokens (gitignored)
└── .gitignore          ← excludes .env, logs/, worktrees/ (default)
```

### Common commands

```bash
# Build/rebuild image after Dockerfile changes
sandcastle docker build-image

# Run the agent against open Sandcastle-labelled issues
npx tsx .sandcastle/main.ts

# Or, if you've added it to package.json:
pnpm sandcastle

# Inspect logs after a run
ls -la .sandcastle/logs/
cat .sandcastle/logs/main-sandcastle-worker-<timestamp>-worker.log

# Clean up a stuck worktree
git worktree remove --force .sandcastle/worktrees/<worktree-name>

# Permission probe (macOS sanity check)
docker run --rm --user $(id -u):$(id -g) -e HOME=/home/agent \
  --entrypoint sh sandcastle:<image-tag> \
  -c 'touch /home/agent/.gitconfig && touch /home/agent/.cache/test && echo ok'
```

### Optional: add to `package.json`

```json
"scripts": {
  "sandcastle": "npx tsx .sandcastle/main.ts"
}
```

So you can run `pnpm sandcastle` instead of the longer form.

---

## When something goes wrong

Sandcastle logs every run to `.sandcastle/logs/main-sandcastle-worker-<timestamp>-worker.log` (gitignored). Read this first — it captures the iteration-by-iteration state including which lifecycle hook is running.

If a run fails at sandbox setup with a permission error → Gotcha 1 (chmod placement).
If a run fails with `HookTimeoutError` → Gotcha 3 (bump `timeoutMs`).
If a run "succeeds" but the agent did nothing → Gotcha 5 (check `GH_TOKEN`).
If `Copying to worktree done (30s)` shows up but you removed `copyToWorktree` → main.ts didn't get rebuilt; verify your edits were saved.

For anything else, the log file plus `docker run --rm --entrypoint sh sandcastle:<tag>` (interactive shell into the same image) is usually enough to reproduce and diagnose.
