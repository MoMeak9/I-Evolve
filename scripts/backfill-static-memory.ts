#!/usr/bin/env -S pnpm tsx
/**
 * backfill-static-memory.ts
 *
 * 迁移仓库（commit 历史被截断、无 MR）的静态快照回填。pack 扫描仓库产出
 * 「清单+摘要」JSON 供 subagent 精读；inject 收 subagent 产出的 candidate
 * JSON，喂 MockAiProvider 跑真实 EvolutionPipeline（judge→audit→write）。
 * 不 commit、不 push。详见 docs/superpowers/specs/2026-06-18-static-memory-backfill-design.md
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---- pack 区（Task 3-5 填充）----

/** git-tracked + 未被 .gitignore 排除的文件（相对路径，已含已 add 的新文件）。 */
export function listTrackedFiles(repo: string): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: repo, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
  );
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}
// ---- inject 区（Task 6-7 填充）----

export async function main(argv: string[]): Promise<void> {
  const sub = argv[0];
  if (sub === 'pack') {
    console.log('pack: not yet implemented');
  } else if (sub === 'inject') {
    console.log('inject: not yet implemented');
  } else {
    console.error('Usage: backfill-static-memory.ts <pack|inject> [options]');
    process.exit(2);
  }
}

// 仅当作为入口运行时执行 main；被测试 import 时不执行。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
