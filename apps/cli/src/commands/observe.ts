import { sendRequest } from '@i-evolve/daemon';

export async function handleObserve(jsonArg: string | undefined): Promise<void> {
  if (!jsonArg) {
    console.error('Error: observation JSON required');
    console.error('Usage: i-evolve observe \'{"id":"...","sessionId":"...","source":"cli",...}\'');
    process.exit(1);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(jsonArg);
  } catch {
    console.error('Error: invalid JSON');
    process.exit(1);
  }

  const resp = await sendRequest({ type: 'observe', payload: payload as any });
  if (resp.ok) {
    console.log(`Observation appended: ${(resp.data as any).id}`);
  } else {
    console.error(`Error: ${resp.error?.message}`);
    process.exit(1);
  }
}
