// -----------------------------------------------------------------------------
// The pure parts: configuration, the parsing of real Leantime answers
// (test/fixtures/leantime), the local days, the lookup by name, and the
// client's reading of the HTTP and JSON-RPC answers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  isLocalAddress,
  normalizeConfig,
  parseNameList,
  parseServerUrl,
} from '../src/config.js';
import { ERROR_KINDS, LeantimeClient, LeantimeError } from '../src/leantime/client.js';
import {
  addDays,
  dayStart,
  dayString,
  findByIdOrName,
  isDoneStatus,
  leantimeDay,
  localDay,
  localTime,
  parseProjects,
  parseTickets,
  summarize,
} from '../src/leantime/model.js';
import { fixture } from './helpers/fakeLeantime.js';
import { START, TIME_ZONE } from './helpers/world.js';

test('the address: bare host, copied browser URL, API URL, reverse proxy prefix', () => {
  assert.equal(parseServerUrl('192.0.2.10:8080'), 'http://192.0.2.10:8080');
  assert.equal(
    parseServerUrl('https://pm.example.org/dashboard/home#/tickets/showTicket/7'),
    'https://pm.example.org',
  );
  assert.equal(parseServerUrl('https://pm.example.org/api/jsonrpc'), 'https://pm.example.org');
  assert.equal(
    parseServerUrl('https://example.org/leantime/tickets/showKanban'),
    'https://example.org/leantime',
  );
  assert.equal(parseServerUrl('http://user:pass@192.0.2.10'), null, 'no credentials in the URL');
  assert.equal(parseServerUrl('ftp://192.0.2.10'), null);
  assert.equal(parseServerUrl('  '), null);
});

test('local or cloud: the address tells', () => {
  for (const url of [
    'http://192.168.1.20:8080',
    'http://10.0.0.5',
    'http://172.20.0.3',
    'http://leantime:8080',
    'https://pm.home.arpa',
    'http://leantime.lan',
    'http://[fd00::5]:8080',
  ]) {
    assert.equal(isLocalAddress(url), true, url);
  }
  for (const url of ['https://acme.leantime.io', 'http://198.51.100.7', 'https://pm.example.org']) {
    assert.equal(isLocalAddress(url), false, url);
  }
});

test('the configuration and its defaults', () => {
  const config = normalizeConfig({ url: 'lt.lan', api_key: ' key ', projects: 'a; b,a' });
  assert.equal(config.url, 'http://lt.lan');
  assert.equal(config.apiKey, 'key');
  assert.deepEqual(config.projects, ['a', 'b']);
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ poll_interval: '7' }).pollIntervalMs, 300_000);
  assert.equal(normalizeConfig({ poll_interval: '60' }).pollIntervalMs, 60_000);
  assert.deepEqual(parseNameList(undefined), []);
  assert.equal(DEFAULT_CONFIG.language, 'fr');
});

test('real projects: id as a string, name; strategies and programs left out', () => {
  const projects = fixture('real-projects').result;
  assert.deepEqual(parseProjects(projects), [
    { id: '2', name: 'Jardin' },
    { id: '1', name: 'Maison' },
  ]);
  assert.deepEqual(
    parseProjects([...projects, { id: 9, name: 'Plan', type: 'strategy' }]).length,
    2,
  );
  assert.deepEqual(parseProjects(false), []);
});

test('the day of a Leantime date: a bare day as is, a web app date in local time', () => {
  assert.equal(leantimeDay('2026-11-22 00:00:00', TIME_ZONE), '2026-11-22');
  assert.equal(leantimeDay('2026-11-22 00:00:00', 'America/Los_Angeles'), '2026-11-22');
  assert.equal(leantimeDay('2026-11-24 20:00:00', TIME_ZONE), '2026-11-24');
  // 23:59 in Paris on 24/11, typed in the web app.
  assert.equal(leantimeDay('2026-11-24 22:59:00', TIME_ZONE), '2026-11-24');
  // 23:59 in Los Angeles on 24/11: 07:59 UTC on the 25th.
  assert.equal(leantimeDay('2026-11-25 07:59:00', 'America/Los_Angeles'), '2026-11-24');
  assert.equal(leantimeDay('0000-00-00 00:00:00', TIME_ZONE), null);
  assert.equal(leantimeDay('', TIME_ZONE), null);
  assert.equal(leantimeDay(null, TIME_ZONE), null);
  assert.equal(leantimeDay('2026-02-30 00:00:00', TIME_ZONE), null);
});

test('the statuses: the type of the project, else Leantime defaults', () => {
  const labels = fixture('real-status-labels').result;
  assert.equal(isDoneStatus(0, labels), true);
  assert.equal(isDoneStatus(-1, labels), true);
  assert.equal(isDoneStatus(4, labels), false);
  assert.equal(isDoneStatus(3, { 3: { statusType: 'DONE' } }), true, 'a custom status');
  assert.equal(isDoneStatus(0, undefined), true);
  assert.equal(isDoneStatus(7, {}), false);
});

const parse = () =>
  parseTickets([...fixture('real-open').result, ...fixture('real-done-today').result], {
    timeZone: TIME_ZONE,
    labels: new Map([
      ['1', fixture('real-status-labels').result],
      ['2', fixture('real-status-labels').result],
    ]),
  });

test('real tickets: due day of a task and of a milestone, assignee, open', () => {
  const items = parse();
  assert.deepEqual(
    items.map((item) => [item.id, item.dueDay, item.open, item.milestone, item.assignee]),
    [
      ['11', '2027-03-20', true, true, ''],
      ['9', '2026-11-25', true, false, 'Camille Martin'],
      ['8', '2026-11-20', true, false, ''],
      ['7', '2026-11-27', true, true, ''],
      ['6', null, true, false, ''],
      ['5', '2026-11-24', true, false, 'Ada Admin'],
      ['3', '2026-11-22', true, false, 'Camille Martin'],
      ['2', '2026-11-22', true, false, 'Ada Admin'],
      ['1', '2026-11-21', true, false, 'Ada Admin'],
      ['10', null, false, false, ''],
      ['4', '2026-11-22', false, false, ''],
    ],
  );
  const bug = items.find((item) => item.id === '9');
  assert.equal(bug.type, 'bug');
  assert.equal(bug.projectName, 'Jardin');
  assert.equal(items.find((item) => item.id === '3').status, 'In Progress');
  assert.equal(items.find((item) => item.id === '7').assigneeId, null, 'a milestone: nobody');
});

test('the counters of a day, for everyone or one assignee', () => {
  const day = localDay(START, TIME_ZONE);
  const summary = summarize(parse(), day);
  assert.equal(summary.open, 7);
  assert.equal(summary.overdue, 2);
  assert.equal(summary.dueToday, 2);
  assert.equal(summary.done, 2);
  assert.equal(summary.next.name, 'Payer la cantine');
  assert.equal(summary.nextMilestone.name, 'Fin des travaux');
  assert.deepEqual(
    summary.agenda.map((item) => item.id),
    ['8', '1', '2', '3'],
  );
  const ada = summarize(parse(), day, { assigneeId: '1' });
  assert.deepEqual([ada.open, ada.overdue, ada.dueToday], [3, 1, 1]);
});

test('find by id or exact name', () => {
  const items = parseProjects(fixture('real-projects').result);
  assert.equal(findByIdOrName(items, 'MAISON').item.id, '1', 'name, case ignored');
  assert.equal(findByIdOrName(items, 'jardin').item.id, '2');
  assert.equal(findByIdOrName(items, '#1').item.id, '1');
  assert.equal(findByIdOrName(items, 'Potager').reason, 'not_found');
  assert.equal(findByIdOrName(items, ' ').reason, 'empty');
  const twins = [
    { id: '1', name: 'Été' },
    { id: '2', name: 'ete' },
  ];
  assert.equal(findByIdOrName(twins, 'ETE').reason, 'ambiguous');
});

test('local days and wall-clock times, across a DST change', () => {
  // 25/10/2026: Paris goes back from UTC+2 to UTC+1 at 03:00.
  assert.equal(
    new Date(localTime(2026, 10, 24, 18, 0, 'Europe/Paris')).toISOString(),
    '2026-10-24T16:00:00.000Z',
  );
  assert.equal(
    new Date(dayStart('2026-10-25', TIME_ZONE)).toISOString(),
    '2026-10-24T22:00:00.000Z',
  );
  assert.equal(
    localDay(dayStart('2026-10-25', TIME_ZONE), TIME_ZONE).end,
    dayStart('2026-10-26', TIME_ZONE),
  );
  assert.equal(dayString(START, TIME_ZONE), '2026-11-22');
  assert.equal(dayString(Date.UTC(2026, 10, 22, 23, 30), TIME_ZONE), '2026-11-23');
  assert.equal(addDays(START, 3, TIME_ZONE), '2026-11-25');
  assert.equal(addDays(START, 40, TIME_ZONE), '2027-01-01');
});

const answer = (status, body) => async () => ({
  status,
  headers: {},
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const kindOf = async (request, call = (client) => client.projects()) => {
  const client = new LeantimeClient({ url: 'http://lt.lan', apiKey: 'k', request });
  try {
    await call(client);
  } catch (err) {
    assert.ok(err instanceof LeantimeError);
    return err.kind;
  }
  return null;
};

test('the client: real errors, an HTML page, a redirect, a network error', async () => {
  assert.equal(await kindOf(answer(401, 'Unauthorized')), ERROR_KINDS.AUTH);
  assert.equal(await kindOf(answer(401, { error: 'Unauthorized' })), ERROR_KINDS.AUTH);
  assert.equal(await kindOf(answer(200, fixture('real-error-forbidden'))), ERROR_KINDS.FORBIDDEN);
  assert.equal(
    await kindOf(answer(200, fixture('real-error-invalid-params'))),
    ERROR_KINDS.INVALID,
  );
  assert.equal(
    await kindOf(answer(200, fixture('real-error-method-not-found'))),
    ERROR_KINDS.UNSUPPORTED,
  );
  assert.equal(await kindOf(answer(200, '<!DOCTYPE html>')), ERROR_KINDS.NOT_LEANTIME);
  assert.equal(await kindOf(answer(404, '<!DOCTYPE html>')), ERROR_KINDS.NOT_LEANTIME);
  assert.equal(await kindOf(answer(200, { error: 'x' })), ERROR_KINDS.NOT_LEANTIME);
  assert.equal(
    await kindOf(answer(200, { jsonrpc: '2.0', result: {}, id: 1 })),
    ERROR_KINDS.NOT_LEANTIME,
    'a list was expected',
  );
  assert.equal(await kindOf(answer(302, '')), ERROR_KINDS.REDIRECT);
  assert.equal(await kindOf(answer(429, '')), ERROR_KINDS.RATE_LIMIT);
  assert.equal(await kindOf(answer(502, '<html>')), ERROR_KINDS.HTTP);
  const refused = async () => {
    throw Object.assign(new Error('self signed'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
  };
  assert.equal(await kindOf(refused), ERROR_KINDS.TLS);
});

test('the client: a ticket without title, refused in the result', async () => {
  const client = new LeantimeClient({
    url: 'http://lt.lan',
    apiKey: 'k',
    request: answer(200, fixture('real-add-no-headline')),
  });
  const err = await client.addTicket({ projectId: '1', headline: '' }).catch((e) => e);
  assert.equal(err.kind, ERROR_KINDS.INVALID);
  assert.equal(err.detail, 'notifications.ticket_save_error_no_headline');
});

test('the client: JSON-RPC 2.0 to /api/jsonrpc, the key in x-api-key', async () => {
  let seen;
  const client = new LeantimeClient({
    url: 'http://lt.lan/leantime',
    apiKey: 'secret',
    request: async (url, options) => {
      seen = { url, ...options };
      return { status: 200, headers: {}, body: JSON.stringify(fixture('real-projects')) };
    },
  });
  assert.equal((await client.projects()).length, 2);
  assert.equal(seen.url, 'http://lt.lan/leantime/api/jsonrpc');
  assert.equal(seen.method, 'POST');
  assert.equal(seen.headers['x-api-key'], 'secret');
  assert.deepEqual(seen.json, {
    jsonrpc: '2.0',
    id: 1,
    method: 'leantime.rpc.Projects.Projects.getAll',
    params: {},
  });
});
