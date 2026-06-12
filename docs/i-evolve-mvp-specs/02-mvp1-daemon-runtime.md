<!--
I-Evolve MVP Implementation Specs
Version: v0.3.1
Date: 2026-06-12
Language: zh-CN
-->

# 02. MVP1：Daemon 必选运行时与写协调基础

> 目标：确立 Daemon 是唯一写协调者，完成进程模型、IPC、锁、事务骨架和基础 Repository wiring。  
> 非目标：不实现 AI 自动提炼、不实现 Git remote push、不实现 Claude Code Plugin。

## 1. 交付目标

```text
- i-evolve daemon start/status/stop 可用。
- daemon 进程级锁可用。
- CLI 可通过 IPC 与 daemon 通信。
- 写操作在 daemon 未运行时拒绝。
- TransactionManager 骨架可用。
- Observation append 可以通过 daemon 写入本地 JSONL。
- Audit append 可以通过 daemon 写入本地 JSONL。
```

## 2. Daemon 进程模型

```text
i-evolve daemon start
  ├─ Process Lock Manager
  ├─ IPC Server
  ├─ Transaction Manager
  ├─ Repository Registry
  ├─ Observation Writer
  ├─ Audit Writer
  ├─ Health Check Worker
  └─ Graceful Shutdown Handler
```

## 3. 本地运行目录

```text
~/.i-evolve/
  config.yaml
  runtime/
    daemon.pid
    daemon.sock
    daemon.lock
  observations/
    current.jsonl
  audit/
    current.jsonl
  logs/
    daemon.log
```

## 4. 进程级锁

锁文件：

```text
~/.i-evolve/runtime/daemon.lock
```

规则：

```text
1. daemon start 前必须尝试获取 lock。
2. 获取失败时检查 pid 是否存活。
3. pid 存活：拒绝启动。
4. pid 不存在：提示 stale lock，并允许 repair。
5. daemon stop 时释放 lock。
```

## 5. IPC 设计

```text
macOS / Linux: Unix Domain Socket
Windows: Named Pipe
Fallback: 不提供写 fallback，仅允许 bootstrap / repair 命令
```

Request：

```ts
export type DaemonRequest =
  | { type: 'ping' }
  | { type: 'health' }
  | { type: 'observe'; payload: Observation }
  | { type: 'audit.append'; payload: AuditAction }
  | { type: 'session.start'; payload: SessionStartInput }
  | { type: 'session.finalize'; payload: SessionFinalizeInput };
```

Response：

```ts
export interface DaemonResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

## 6. CLI 行为

允许无 daemon：

```bash
i-evolve daemon start
i-evolve daemon status
i-evolve doctor --bootstrap
i-evolve repair stale-lock
```

必须依赖 daemon：

```bash
i-evolve observe
i-evolve session finalize
i-evolve memory add
i-evolve memory update
i-evolve memory forget
```

daemon 未运行时报错：

```text
Error: i-evolve daemon is not running.
Run: i-evolve daemon start
```

## 7. TransactionManager 骨架

```ts
export interface TransactionManager {
  run<T>(
    name: string,
    options: TransactionOptions,
    fn: (tx: Transaction) => Promise<T>
  ): Promise<T>;
}
```

MVP1 要求：

```text
- 同一 daemon 内写操作串行化。
- 事务有日志。
- 事务失败返回统一错误。
- 后续 MVP2 在此基础上接入 Markdown atomic write。
```

## 8. ObservationRepository 实现

写入：

```text
~/.i-evolve/observations/current.jsonl
```

append 必须：

```text
1. 校验 observation schema。
2. 添加 received_at。
3. 一行一个 JSON。
4. fsync 或安全 flush。
5. 返回 observation id。
```

## 9. AuditRepository 实现

写入：

```text
~/.i-evolve/audit/current.jsonl
```

append 必须：

```text
1. 校验 audit-action schema。
2. 记录 actor。
3. 记录 transaction_id。
4. 一行一个 JSON。
```

## 10. Daemon 命令

```bash
i-evolve daemon start
i-evolve daemon start --foreground
i-evolve daemon stop
i-evolve daemon restart
i-evolve daemon status
i-evolve daemon logs
```

## 11. 测试

```text
[ ] daemon start 后 ping 成功。
[ ] 重复 daemon start 被拒绝。
[ ] daemon stop 后 status 显示 stopped。
[ ] CLI observe 在 daemon 未运行时报错。
[ ] CLI observe 在 daemon 运行时写入 JSONL。
[ ] malformed observation 被拒绝。
[ ] audit.append 可写入 JSONL。
[ ] transaction 失败时返回标准错误。
```

## 12. 验收清单

```text
[ ] Daemon 是唯一写入口。
[ ] daemon lock 生效。
[ ] IPC ping / health 可用。
[ ] ObservationRepository append 可用。
[ ] AuditRepository append 可用。
[ ] TransactionManager 骨架可用。
[ ] daemon 未运行时写操作拒绝。
```
