import { connect } from 'node:net';
import { existsSync } from 'node:fs';
import { paths } from './paths.js';
import type { DaemonRequest, DaemonResponse } from './ipc-types.js';
import { IEvolveError } from '@i-evolve/shared';

export class DaemonNotRunningError extends IEvolveError {
  constructor() {
    super('i-evolve daemon is not running. Run: i-evolve daemon start', 'DAEMON_NOT_RUNNING');
    this.name = 'DaemonNotRunningError';
  }
}

export async function sendRequest<T = unknown>(request: DaemonRequest): Promise<DaemonResponse<T>> {
  if (!existsSync(paths.runtime.sock)) {
    throw new DaemonNotRunningError();
  }

  return new Promise((resolve, reject) => {
    const socket = connect(paths.runtime.sock);
    let buffer = '';

    socket.on('connect', () => {
      socket.write(JSON.stringify(request) + '\n');
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
    });

    socket.on('end', () => {
      try {
        resolve(JSON.parse(buffer));
      } catch (err) {
        reject(new IEvolveError('Failed to parse daemon response', 'IPC_PARSE_ERROR'));
      }
    });

    socket.on('error', () => {
      reject(new DaemonNotRunningError());
    });
  });
}
