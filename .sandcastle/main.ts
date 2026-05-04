import { claudeCode, run } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

// Simple loop: an agent that picks open GitHub issues one by one and closes them.
// Run this with: npx tsx .sandcastle/main.ts
// Or add to package.json scripts: "sandcastle": "npx tsx .sandcastle/main.ts"

await run({
	// A name for this run, shown as a prefix in log output.
	name: "worker",

	// Sandbox provider — Docker is the default runtime.
	sandbox: docker(),

	// The agent provider. Pass a model string to claudeCode() — opus 4.7 is the
	// most capable model with a step-change in agentic coding over 4.6. Switch to
	// claude-sonnet-4-6 for cheaper/faster runs on simpler tasks, or
	// claude-haiku-4-5-20251001 for speed-first work. Note: 4.7 uses 1.0–1.35x
	// more tokens than 4.6 due to the new tokenizer; budget AFK runs accordingly.
	agent: claudeCode("claude-opus-4-7"),

	// Path to the prompt file. Shell expressions inside are evaluated inside the
	// sandbox at the start of each iteration, so the agent always sees fresh data.
	promptFile: "./.sandcastle/prompt.md",

	// Maximum number of iterations (agent invocations) to run in a session.
	// Each iteration works on a single issue. Increase this to process more issues
	// per run, or set it to 1 for a single-shot mode.
	maxIterations: 3,

	// Branch strategy — merge-to-head creates a temporary branch for the agent
	// to work on, then merges the result back to HEAD when the run completes.
	// This is required when using copyToWorktree, since head mode bind-mounts
	// the host directory directly (no worktree to copy into).
	branchStrategy: { type: "merge-to-head" },

	// Note: copyToWorktree: ["node_modules"] is intentionally NOT used here.
	// The host (macOS arm64) and container (linux/amd64 or arm64) architectures
	// differ, so any copied node_modules would be detected as inconsistent by
	// pnpm and reinstalled from scratch — paying the copy cost for zero benefit.
	// Instead, pnpm install runs cleanly in the container using its store cache.

	// Lifecycle hooks — commands grouped by where they run (host or sandbox).
	hooks: {
		sandbox: {
			// onSandboxReady runs once after the sandbox is initialised and the repo is
			// synced in, before the agent starts. Use it to install dependencies or run
			// any other setup steps your project needs.
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
