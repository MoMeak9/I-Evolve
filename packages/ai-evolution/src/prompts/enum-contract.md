STRICT OUTPUT CONTRACT (must follow exactly):
- Output ONLY valid JSON. No prose, no markdown fences, no trailing text.
- If the expected shape is an object, return `{...}`. If an array, return `[...]`.
- "type" when present MUST be one of: repo_fact, task_constraint, decision, pitfall, workflow_rule.
- "proposedScope" when present MUST be one of: global, domain, repo, task.
- "confidence" when present MUST be a number between 0 and 1.
- If uncertain between two enum values, choose the more conservative one.
- Prefer FEWER high-quality items over MANY low-quality ones.
- A candidate that would not survive 30 days of relevance should not be proposed.
