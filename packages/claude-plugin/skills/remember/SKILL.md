---
name: remember
description: Capture a durable memory (preference, fact, decision, or rule) for this repo or project.
---

# I-Evolve: Remember

Persist a memory the user wants kept across sessions.

Steps:
1. Clarify the memory: title, type (project_fact, repo_fact, user_preference, decision, pitfall, workflow_rule), and scope.
2. Write a Markdown memory file with snake_case frontmatter.
3. Add it via `i-evolve memory add --file <path>`.

Never store secrets, credentials, or PII. The CLI performs schema validation.
