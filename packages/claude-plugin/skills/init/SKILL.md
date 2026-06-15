---
name: init
description: Initialize I-Evolve for the current repository, bind project identity, and choose a shared-memory git remote.
---

# I-Evolve: Init

Onboard the current repository. Prefer the guided CLI command, which starts the
daemon, binds project identity (after confirmation), and asks which remote git
repo to use as shared memory.

## Guided (recommended)

Run the interactive wizard in a terminal the user can answer in:

```bash
i-evolve init
```

It will:
1. Auto-start the daemon.
2. Detect repo identity and confirm the project id / domain before binding.
3. List the repo's git remotes and ask which to use as shared memory (or skip for local-only).
4. Run a health check.

## Agent-driven (no TTY)

When you cannot hand the user an interactive prompt, gather the answers
yourself, then call the CLI non-interactively:

1. Detect candidates:
   ```bash
   i-evolve identity detect
   ```
   This reports `repoId`, `gitRemote`, suggested `projectId`, and `domain`.
2. Ask the user two things:
   - The project id and domain to bind (offer the detected values as defaults).
   - Which remote git repo should store shared memory — list `gitRemote` from
     detection as the default candidate, or offer local-only.
3. Apply their answers:
   ```bash
   i-evolve init --yes --project <project-id> --domain <domain> --remote <git-url>
   # or, for local-only memory:
   i-evolve init --yes --project <project-id> --domain <domain> --skip-remote
   ```

Flags:
- `--yes` accepts detected values and skips prompts.
- `--remote <url>` wires a shared-memory git remote without asking.
- `--skip-remote` keeps memory local-only.
- `--non-interactive` only starts the daemon and reports detection (no writes).

This skill only orchestrates the CLI. It does not write storage directly.
