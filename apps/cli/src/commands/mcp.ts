import { sendRequest } from '@i-evolve/daemon';

export async function handleMcpCommand(subcommand: string | undefined, flags: Record<string, unknown>): Promise<void> {
  switch (subcommand) {
    case 'start': {
      try {
        const resp = await sendRequest({ type: 'health' });
        if (!resp.ok) throw new Error(resp.error?.message ?? 'daemon unavailable');
        console.log(flags.stdio ? 'MCP server ready on stdio.' : 'MCP server ready.');
      } catch {
        console.error('Error: I-Evolve daemon is not running. Run: i-evolve daemon start');
        process.exit(1);
      }
      break;
    }
    case 'status': {
      try {
        const resp = await sendRequest({ type: 'health' });
        console.log(resp.ok ? 'MCP server: ready (daemon running)' : 'MCP server: blocked');
      } catch {
        console.log('MCP server: blocked (daemon not running)');
      }
      break;
    }
    default:
      console.error('Usage: i-evolve mcp <start|status> [--stdio]');
      process.exit(1);
  }
}
