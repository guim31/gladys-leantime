// The fake Leantime answers the captured calls exactly as the real server did.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API_KEY, FakeLeantime, fixture } from './helpers/fakeLeantime.js';

async function call(server, method, params) {
  const response = await server.handle({
    method: 'POST',
    path: '/api/jsonrpc',
    headers: { 'x-api-key': API_KEY },
    json: { jsonrpc: '2.0', id: 1, method: `leantime.rpc.${method}`, params },
  });
  return JSON.parse(response.body);
}

test('the fake answers the captured calls like the real Leantime', async () => {
  const server = new FakeLeantime();
  const cases = [
    ['Projects.Projects.getAll', {}, 'real-projects'],
    ['Tickets.Tickets.getAll', { searchCriteria: { statusType: 'NEW,INPROGRESS' } }, 'real-open'],
    [
      'Tickets.Tickets.getAll',
      { searchCriteria: { statusType: 'DONE', modifiedAfter: '2026-11-21T23:00:00Z' } },
      'real-done-today',
    ],
    ['Tickets.Tickets.getAll', { searchCriteria: {} }, 'real-all'],
    ['Tickets.Tickets.getStatusLabels', { projectId: 1 }, 'real-status-labels'],
    [
      'Tickets.Tickets.getAll',
      { searchCriteria: { statusType: 'BOGUS' } },
      'real-error-invalid-params',
    ],
    [
      'Tickets.Tickets.addTicket',
      { values: { headline: '', projectId: 1 } },
      'real-add-no-headline',
    ],
    ['Nope.Nope.x', {}, 'real-error-method-not-found'],
  ];
  for (const [method, params, name] of cases) {
    assert.deepEqual(await call(server, method, params), fixture(name), name);
  }
});

test('a wrong key gets the HTTP 401 of the real server', async () => {
  const server = new FakeLeantime();
  const response = await server.handle({
    method: 'POST',
    path: '/api/jsonrpc',
    headers: { 'x-api-key': 'lt_wrong_key' },
    json: { jsonrpc: '2.0', id: 1, method: 'leantime.rpc.Projects.Projects.getAll' },
  });
  assert.equal(response.status, 401);
});
