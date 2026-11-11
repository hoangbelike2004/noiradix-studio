// Isolated ACP protocol fixture. Never authenticates or contacts a provider.
import readline from 'node:readline';
let next = 1000, mcp, sessionId = 'fixture-google-session', model = 'gemini-fixture';
const requests = new Map();
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const request = (method, params) => new Promise((resolve, reject) => { const id = next++; requests.set(id, { resolve, reject }); send({ id, method, params }); });
const models = () => [{ id: 'model', category: 'model', name: 'Model', type: 'select', currentValue: model,
  options: [{ value: 'gemini-fixture', name: 'Google fixture' }, { value: 'gemini-fixture-2', name: 'Google fixture 2' }] }];
async function tools(method, params = {}) {
  const response = await fetch(mcp.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...Object.fromEntries(mcp.headers.map(item => [item.name, item.value])) },
    body: JSON.stringify({ jsonrpc: '2.0', id: next++, method, params }) });
  return (await response.json()).result;
}
async function receive(message) {
  if (!message.method) {
    const item = requests.get(message.id); if (item) { requests.delete(message.id); message.error ? item.reject(message.error) : item.resolve(message.result); } return;
  }
  const { id, params } = message;
  try {
    if (message.method === 'initialize') {
      let fsDenied = false;
      if (params.testClientFs) { try { await request('fs/read_text_file', { sessionId, path: '/private/credential' }); } catch (error) { fsDenied = error.code === -32601; } }
      return send({ id, result: { protocolVersion: 1, agentInfo: { name: 'fixture', version: '1' },
      agentCapabilities: { mcpCapabilities: { http: true }, promptCapabilities: { image: true } }, authMethods: [{ id: 'oauth-personal', name: 'Log in with Google' }],
      testHasApiKey: Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY), testFsDenied: fsDenied } });
    }
    if (message.method === 'authenticate') { if (params.methodId !== 'oauth-personal') throw new Error('Wrong login'); return send({ id, result: {} }); }
    if (message.method === 'session/new') {
      mcp = params.mcpServers[0];
      const init = await tools('initialize', { protocolVersion: '2025-03-26' }); if (!init.capabilities.tools) throw new Error('No tools');
      const list = await tools('tools/list'); if (!list.tools.some(tool => tool.name === 'draw')) throw new Error('No drawing');
      return send({ id, result: { sessionId, configOptions: models() } });
    }
    if (message.method === 'session/set_config_option') { model = params.value; return send({ id, result: { configOptions: models() } }); }
    if (message.method === 'session/prompt') {
      const decision = await request('session/request_permission', { sessionId, toolCall: { toolCallId: 'fixture-draw', title: 'Draw one actual pixel', kind: 'edit', rawInput: { tool: 'draw', color: '#00dd88' } },
        options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'deny', name: 'Reject', kind: 'reject_once' }] });
      if (decision.outcome.optionId !== 'once') { send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Permission declined.' } } } }); return send({ id, result: { stopReason: 'end_turn' } }); }
      const output = await tools('tools/call', { name: 'draw', arguments: { actions: [{ tool: 'pen', color: '#00dd88', points: [{ x: 2, y: 0 }] }] } });
      if (output.isError || !JSON.stringify(output).includes('#00dd88')) throw new Error('Actual editor did not confirm pixel');
      if (params.prompt[0].text.includes('CANCEL_FIXTURE')) return;
      send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'usage_update', used: 320, size: 100000 } } });
      send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'PRIVATE_THOUGHT_DO_NOT_EXPOSE' } } } });
      send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Google fixture verified editor pixel.' } } } });
      return send({ id, result: { stopReason: 'end_turn' } });
    }
    if (message.method === 'session/cancel') return;
    if (id !== undefined) send({ id, error: { code: -32601, message: 'Fixture method not found' } });
  } catch { if (id !== undefined) send({ id, error: { code: -32603, message: 'Fixture failure' } }); }
}
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => { receive(JSON.parse(line)).catch(() => {}); });
input.on('close', () => process.exit(0));
