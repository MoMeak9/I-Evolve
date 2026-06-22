import { execFileSync } from 'node:child_process';
import type { AiProvider } from './AiProvider.js';
import { ClaudeCliProvider } from './claude-cli-provider.js';
import { CodexCliProvider } from './codex-cli-provider.js';
import { OpenAiCompatibleProvider } from './openai-compatible-provider.js';

function commandExists(cmd: string): boolean {
  try {
    execFileSync('which', [cmd], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

export function getProvider(): AiProvider {
  // 1. Explicit Claude CLI opt-in
  if (process.env.IEVOLVE_CLAUDE_CLI === '1') {
    const model = process.env.IEVOLVE_CLAUDE_MODEL ?? 'sonnet';
    return new ClaudeCliProvider(model);
  }

  // 2. Auto-detect claude in PATH
  if (commandExists('claude')) {
    const model = process.env.IEVOLVE_CLAUDE_MODEL ?? 'sonnet';
    return new ClaudeCliProvider(model);
  }

  // 3. Explicit Codex CLI opt-in
  if (process.env.IEVOLVE_CODEX_CLI === '1') {
    const model = process.env.IEVOLVE_CODEX_MODEL;
    return new CodexCliProvider(model);
  }

  // 4. Auto-detect codex in PATH
  if (commandExists('codex')) {
    const model = process.env.IEVOLVE_CODEX_MODEL;
    return new CodexCliProvider(model);
  }

  // 5. OpenAI-compatible endpoint
  const baseUrl = process.env.IEVOLVE_AI_BASE_URL;
  const apiKey = process.env.IEVOLVE_AI_API_KEY;
  const model = process.env.IEVOLVE_AI_MODEL;
  if (baseUrl && apiKey && model) {
    return new OpenAiCompatibleProvider({ baseUrl, apiKey, model });
  }

  // 6. No provider available
  throw new Error(
    'No AI provider available. Install Claude CLI or Codex CLI, or set IEVOLVE_AI_BASE_URL + IEVOLVE_AI_API_KEY + IEVOLVE_AI_MODEL.',
  );
}
