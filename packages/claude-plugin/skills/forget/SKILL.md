---
name: forget
description: Forget a memory (soft deprecate or tombstone so it is never regenerated).
---

# I-Evolve: Forget

Remove a memory from active context.

Steps:
1. Identify the memory id (use `i-evolve memory list` or `i-evolve memory search`).
2. Soft forget (deprecate, keep file): `i-evolve memory forget <id> --mode soft`.
3. Tombstone (prevent regeneration): `i-evolve memory forget <id> --mode tombstone`.

Confirm with the user before tombstoning.
