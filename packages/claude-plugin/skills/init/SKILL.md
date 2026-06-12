---
name: init
description: Initialize I-Evolve for the current repository and start the daemon.
---

# I-Evolve: Init

Set up I-Evolve for this repository.

Steps:
1. Ensure the daemon is running: run `i-evolve daemon start`.
2. Initialize the local memory repository: run `i-evolve memory init-local`.
3. Confirm health: run `i-evolve doctor --bootstrap`.

This skill only orchestrates the CLI. It does not write storage directly.
