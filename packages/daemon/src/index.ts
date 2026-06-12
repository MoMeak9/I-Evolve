export { Daemon } from './daemon.js';
export { ProcessLock } from './lock.js';
export { IpcServer } from './ipc-server.js';
export { sendRequest, DaemonNotRunningError } from './ipc-client.js';
export { SerialTransactionManager } from './transaction-manager.js';
export { ObservationWriter } from './observation-writer.js';
export { AuditWriter } from './audit-writer.js';
export { paths, setBasePath } from './paths.js';
export type {
	  DaemonRequest,
	  DaemonResponse,
	  SessionStartInput,
	  SessionFinalizeInput,
	  MemoryRecallInput,
	  MemorySearchInput,
	  MemoryRememberInput,
	  MemoryForgetInput,
	  MemoryAuditInput,
	  MemoryExplainInput,
	  MemorySyncInput,
	  DashboardSummaryInput,
	  DashboardRollbackInput,
	} from './ipc-types.js';
