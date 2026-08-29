import { client, methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';

const base = process.argv[2] ?? 'http://127.0.0.1:41999';
const token = process.argv[3] ?? 'fleet-smoke-secret';

const acpUrl = new URL(`${base}/acp`);
acpUrl.protocol = acpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
acpUrl.searchParams.set('token', token);

const app = client({ name: 'fleet-smoke' });
const stream = createWebSocketStream(acpUrl.toString(), { protocols: [] });
const connection = app.connect(stream);

try {
  const init = await Promise.race([
    connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { elicitation: { form: {} } },
      clientInfo: { name: 'fleet-smoke', version: '0.0.0' },
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('initialize timeout')), 10000)),
  ]);
  console.log('SMOKE-OK agent:', init.agentInfo?.name, 'protocol:', init.protocolVersion);
  process.exit(0);
} catch (error) {
  console.error('SMOKE-FAIL:', error?.message ?? error);
  process.exit(1);
} finally {
  connection.close();
}
