import type { MonitorEvent, MonitorSnapshot } from './types.js';

export interface MonitorClientHandlers {
  onSnapshot: (snap: MonitorSnapshot) => void;
  onEvent: (e: MonitorEvent) => void;
  onStatus: (connected: boolean) => void;
}

export class MonitorClient {
  private es: EventSource | null = null;
  constructor(private base = '') {}

  async start(h: MonitorClientHandlers): Promise<void> {
    try {
      const snap = await fetch(`${this.base}/snapshot`).then((r) => r.json());
      h.onSnapshot(snap);
      h.onStatus(true);
    } catch {
      h.onStatus(false);
    }
    this.es = new EventSource(`${this.base}/events`);
    this.es.onmessage = (ev) => {
      try {
        h.onEvent(JSON.parse(ev.data));
      } catch {
        /* ignore bad frame */
      }
    };
    this.es.onerror = () => h.onStatus(false);
    this.es.onopen = () => h.onStatus(true);
  }

  stop(): void {
    this.es?.close();
    this.es = null;
  }
}
