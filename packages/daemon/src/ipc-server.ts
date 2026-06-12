import { createServer, type Server, type Socket } from 'node:net';
import { existsSync, unlinkSync } from 'node:fs';
import { paths } from './paths.js';
import type { DaemonRequest, DaemonResponse } from './ipc-types.js';

export type RequestHandler = (req: DaemonRequest) => Promise<DaemonResponse>;

export class IpcServer {
  private server: Server | null = null;

  constructor(private handler: RequestHandler) {}

  async start(): Promise<void> {
    if (existsSync(paths.runtime.sock)) {
      unlinkSync(paths.runtime.sock);
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => this.onConnection(socket));
      this.server.on('error', reject);
      this.server.listen(paths.runtime.sock, () => resolve());
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => {
        if (existsSync(paths.runtime.sock)) {
          unlinkSync(paths.runtime.sock);
        }
        resolve();
      });
    });
  }

  private onConnection(socket: Socket): void {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const delimIndex = buffer.indexOf('\n');
      if (delimIndex === -1) return;

      const message = buffer.slice(0, delimIndex);
      buffer = buffer.slice(delimIndex + 1);

      this.handleMessage(message, socket);
    });
  }

  private async handleMessage(raw: string, socket: Socket): Promise<void> {
    let response: DaemonResponse;
    try {
      const request: DaemonRequest = JSON.parse(raw);
      response = await this.handler(request);
    } catch (err) {
      response = {
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      };
    }
    socket.write(JSON.stringify(response) + '\n');
    socket.end();
  }
}
