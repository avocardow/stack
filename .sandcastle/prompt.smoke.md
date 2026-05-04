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
