import { join } from 'node:path';
import { homedir } from 'node:os';

function buildPaths(baseDir: string) {
  return {
    base: baseDir,
    config: join(baseDir, 'config.yaml'),
    runtime: {
      dir: join(baseDir, 'runtime'),
      pid: join(baseDir, 'runtime', 'daemon.pid'),
      sock: join(baseDir, 'runtime', 'daemon.sock'),
      lock: join(baseDir, 'runtime', 'daemon.lock'),
    },
    observations: {
      dir: join(baseDir, 'observations'),
      current: join(baseDir, 'observations', 'current.jsonl'),
    },
    audit: {
      dir: join(baseDir, 'audit'),
      current: join(baseDir, 'audit', 'current.jsonl'),
    },
    logs: {
      dir: join(baseDir, 'logs'),
      daemon: join(baseDir, 'logs', 'daemon.log'),
    },
    sessions: {
      dir: join(baseDir, 'sessions'),
    },
    shared: {
      dir: join(baseDir, 'shared'),
      memory: join(baseDir, 'shared', 'memory'),
    },
  };
}

export type Paths = ReturnType<typeof buildPaths>;

const DEFAULT_BASE = join(homedir(), '.i-evolve');

let _paths: Paths = buildPaths(DEFAULT_BASE);

export const paths: Paths = new Proxy({} as Paths, {
  get(_target, prop) {
    return (_paths as any)[prop];
  },
  ownKeys() {
    return Object.keys(_paths);
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (prop in _paths) {
      return { configurable: true, enumerable: true, value: (_paths as any)[prop] };
    }
    return undefined;
  },
});

export function setBasePath(baseDir: string): void {
  _paths = buildPaths(baseDir);
}
