// -----------------------------------------------------------------------------
// The hub against the in-memory Leantime (real answers of leantime/leantime
// 3.15.3): counters, followed projects, scene events, the scene actions, the
// API key and the error cases. The clock starts on 22/11/2026 at 19:00 in
// Paris (UTC+1), a Sunday.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BASE_CONFIG,
  FakeLeantime,
  PROJECTS,
  START,
  STATUSES,
  URL_1,
  createClock,
  createWorld,
  instanceId,
  projectId,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const counters = (w, ids) => ({
  open: w.fake.lastState(ids.feature('open')),
  dueToday: w.fake.lastState(ids.feature('due_today')),
  overdue: w.fake.lastState(ids.feature('overdue')),
  done: w.fake.lastState(ids.feature('done_today')),
  milestone: w.fake.lastState(ids.feature('next_milestone')),
});

const INSTANCE = {
  open: 7,
  dueToday: 2,
  overdue: 2,
  done: 2,
  milestone: 'Fin des travaux · Fri 27 Nov',
};

const events = (w) => w.fake.sceneEvents.map((event) => `${event.key}:${event.data.task}`);
const MIDNIGHT = '2026-11-22T23:00:30Z'; // 00:00 in Paris, Monday 23/11

test('the fixtures start where the tests expect them', () => {
  assert.equal(new Date(START).toISOString(), '2026-11-22T18:00:00.000Z');
  assert.equal(URL_1, 'http://leantime.lan:8080');
});

test('the instance device and one device per followed project, with their counters', async (t) => {
  const w = await world(t);
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => [device.name, device.external_id]),
    [
      ['Leantime', instanceId(w.gladys).device],
      ['Leantime Jardin', projectId(w.gladys, PROJECTS.JARDIN).device],
      ['Leantime Maison', projectId(w.gladys, PROJECTS.MAISON).device],
    ],
  );
  assert.deepEqual(counters(w, instanceId(w.gladys)), INSTANCE);
  assert.deepEqual(counters(w, projectId(w.gladys, PROJECTS.MAISON)), {
    open: 5,
    dueToday: 2,
    overdue: 1,
    done: 1,
    milestone: 'Fin des travaux · Fri 27 Nov',
  });
  assert.deepEqual(counters(w, projectId(w.gladys, PROJECTS.JARDIN)), {
    open: 2,
    dueToday: 0,
    overdue: 1,
    done: 1,
    milestone: 'Printemps · Sat 20 Mar',
  });
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.deepEqual(
    w.fake.transports.map((entry) => entry.transport),
    ['local', 'local', 'local'],
  );
});

test('no followed project: the instance device only', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, projects: '' } });
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['Leantime'],
  );
});

test('projects by name or number; an unknown one is reported', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, projects: 'MAISON, 2, potager' } });
  assert.equal(w.fake.discoveredDevices.length, 3);
  assert.deepEqual(w.hub.unknownProjects, ['potager']);
  const report = await w.fake.action('test_connection');
  assert.equal(report.success, true);
  assert.match(
    report.data.message.en,
    /^Leantime OK: 7 open task\(s\) in 2 project\(s\), 2 followed/,
  );
  assert.match(report.data.message.fr, /Projet\(s\) inconnu\(s\) ignoré\(s\) : potager/);
});

test('the calls: three per reading, the statuses of each project once an hour', async (t) => {
  const w = await world(t);
  assert.deepEqual(
    w.server.requests.map((request) => [
      request.method.replace('leantime.rpc.', ''),
      request.params,
    ]),
    [
      ['Projects.Projects.getAll', {}],
      ['Tickets.Tickets.getAll', { searchCriteria: { statusType: 'NEW,INPROGRESS' } }],
      [
        'Tickets.Tickets.getAll',
        // Local midnight in Paris, without milliseconds (refused by Leantime).
        { searchCriteria: { statusType: 'DONE', modifiedAfter: '2026-11-21T23:00:00Z' } },
      ],
      ['Tickets.Tickets.getStatusLabels', { projectId: 2 }],
      ['Tickets.Tickets.getStatusLabels', { projectId: 1 }],
    ],
  );
  w.clock.advance(5 * 60_000);
  await w.hub.poll();
  assert.equal(w.server.requests.length, 5 + 3);
  w.clock.advance(60 * 60_000);
  await w.hub.poll();
  assert.equal(w.server.requests.length, 8 + 5);
});

test('an older Leantime that ignores the filters: the statuses sort the tickets', async (t) => {
  const server = new FakeLeantime();
  server.ignoresFilters = true;
  const w = await world(t, { server });
  assert.deepEqual(counters(w, instanceId(w.gladys)), INSTANCE);
});

test('a key that may not read the statuses: Leantime default statuses', async (t) => {
  const server = new FakeLeantime();
  server.labelsForbidden.add('1');
  server.labelsForbidden.add('2');
  const w = await world(t, { server });
  assert.deepEqual(counters(w, instanceId(w.gladys)), INSTANCE);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('midnight crossed during a slow reading: read again soon', async (t) => {
  const clock = createClock(Date.UTC(2026, 10, 22, 22, 59, 55));
  const w = await world(t, { clock });
  const readAt = clock.now();
  clock.advance(11_000);
  assert.equal(w.hub.nextDelay(readAt), w.hub.timings.minDelayMs);
  assert.equal(w.hub.nextDelay(), 5 * 60_000);
});

test('"overdue" at midnight, with the task details', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  assert.deepEqual(events(w), [], 'nothing on the first reading');
  clock.set(MIDNIGHT);
  await w.hub.poll();
  assert.deepEqual(events(w), [
    'task_overdue:Payer la cantine',
    'task_overdue:Arroser les plantes',
  ]);
  assert.deepEqual(w.fake.sceneEvents[0].data, {
    task: 'Payer la cantine',
    task_id: '2',
    project: projectId(w.gladys, PROJECTS.MAISON).device,
    project_name: 'Maison',
    type: 'task',
    status: 'New',
    assignee: 'Ada Admin',
    due_date: '2026-11-22',
    url: `${URL_1}/tickets/showTicket/2`,
  });
  // A date typed in the web app (stored in UTC, 24/11 20:00): overdue at the
  // end of 24/11 in Paris, not a day off.
  clock.set('2026-11-24T23:00:30Z');
  await w.hub.poll();
  assert.deepEqual(events(w).slice(2), ['task_overdue:Reparer le robinet']);
});

test('a done task fires nothing; one reopened with an assignee is "assigned"', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  w.server.update(2, { status: STATUSES.DONE });
  w.server.update(4, {
    status: STATUSES.NEW,
    editorId: 4,
    editorFirstname: 'Camille',
    editorLastname: 'Martin',
  });
  clock.set(MIDNIGHT);
  await w.hub.poll();
  assert.deepEqual(events(w), [
    'task_assigned:Changer les draps',
    'task_overdue:Arroser les plantes',
    'task_overdue:Changer les draps',
  ]);
  assert.equal(w.fake.sceneEvents[0].data.assignee, 'Camille Martin');
});

test('assigned: a new or changed assignee fires once, a restart does not repeat it', async (t) => {
  const clock = createClock();
  const server = new FakeLeantime();
  const first = await createWorld({ clock, server });
  server.update(8, { editorId: 1, editorFirstname: 'Ada', editorLastname: 'Admin' });
  server.update(9, { editorId: 1, editorFirstname: 'Ada', editorLastname: 'Admin' });
  server.update(2, { editorId: null });
  clock.advance(60_000);
  await first.hub.poll();
  assert.deepEqual(events(first), [
    'task_assigned:Tondre la pelouse',
    'task_assigned:Tailler la haie',
  ]);
  await first.app.stop();
  const second = await world(t, { clock, server, dataDir: first.dataDir });
  clock.advance(60_000);
  await second.hub.poll();
  assert.deepEqual(events(second), [], 'known since the previous run (under /data)');
  server.update(2, { editorId: 1, editorFirstname: 'Ada', editorLastname: 'Admin' });
  clock.advance(60_000);
  await second.hub.poll();
  assert.deepEqual(events(second), ['task_assigned:Payer la cantine']);
});

test('a new task created with an assignee is "assigned"; milestones never are', async (t) => {
  const w = await world(t);
  await w.fake.sceneAction('create_task', { title: 'Nouvelle', project: 'Maison' });
  const created = w.server.find(13);
  w.server.update(13, { editorId: 1, editorFirstname: 'Ada', editorLastname: 'Admin' });
  w.server.update(7, { editorId: 4, editorFirstname: 'Camille', editorLastname: 'Martin' });
  w.clock.advance(60_000);
  await w.hub.poll();
  assert.equal(created.headline, 'Nouvelle');
  assert.deepEqual(events(w), ['task_assigned:Nouvelle']);
});

test('an event missed while stopped fires at the restart, within the hour', async (t) => {
  const clock = createClock(Date.UTC(2026, 10, 22, 22, 50));
  const server = new FakeLeantime();
  const first = await createWorld({ clock, server });
  await first.app.stop();
  clock.set('2026-11-22T23:20:00Z'); // 00:20 in Paris
  const second = await world(t, { clock, server, dataDir: first.dataDir });
  assert.deepEqual(events(second), [
    'task_overdue:Payer la cantine',
    'task_overdue:Arroser les plantes',
  ]);
});

test('a refused event is sent again at the next reading, the others not twice', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  let refuse = 2;
  const publish = w.gladys.publishSceneEvent.bind(w.gladys);
  w.gladys.publishSceneEvent = async (key, data) => {
    if (data.task === 'Arroser les plantes' && refuse-- > 0) {
      throw new Error('HTTP 503');
    }
    return publish(key, data);
  };
  clock.set(MIDNIGHT);
  await w.hub.poll();
  clock.advance(60_000);
  await w.hub.poll();
  clock.advance(60_000);
  await w.hub.poll();
  assert.deepEqual(events(w), [
    'task_overdue:Payer la cantine',
    'task_overdue:Arroser les plantes',
  ]);
});

test('the counters move at midnight', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  clock.set(MIDNIGHT);
  await w.hub.poll();
  assert.deepEqual(counters(w, instanceId(w.gladys)), {
    open: 7,
    dueToday: 0,
    overdue: 4,
    done: 0,
    milestone: 'Fin des travaux · Fri 27 Nov',
  });
});

test('Leantime down: unreachable devices, a status message, then back', async (t) => {
  const w = await world(t);
  w.server.failure = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  await w.hub.poll();
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(w.fake.connectionStatus.message.fr, 'Leantime ne répond pas');
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  w.server.failure = null;
  await w.hub.poll();
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(w.fake.transports.at(-1).transport, 'local');
});

test('a wrong key, a wrong address, an address without the API', async (t) => {
  const server = new FakeLeantime();
  const w = await world(t, { server, config: { ...BASE_CONFIG, api_key: 'lt_nope_nope' } });
  assert.equal(w.fake.connectionStatus.message.en, 'API key refused (mistyped or deleted?)');
  await w.fake.configUpdated({ ...BASE_CONFIG, url: `${URL_1}/wrong-prefix` });
  assert.match(w.fake.connectionStatus.message.en, /^no Leantime API at this address/);
  await w.fake.configUpdated({ ...BASE_CONFIG, url: 'http://198.51.100.7' });
  assert.equal(w.fake.connectionStatus.message.en, 'Leantime does not answer');
  await w.fake.configUpdated({ ...BASE_CONFIG, url: 'ftp://x' });
  assert.equal(
    w.fake.connectionStatus.message.en,
    'Address not understood, e.g. http://192.168.1.20:8080',
  );
  await w.fake.configUpdated({ ...BASE_CONFIG, api_key: '' });
  assert.equal(
    w.fake.connectionStatus.message.en,
    'Enter a Leantime API key in the configuration.',
  );
  const report = await w.fake.action('test_connection');
  assert.equal(report.success, false);
  assert.equal(
    report.error.fr,
    "Leantime : Saisissez une clé d'API de Leantime dans la configuration.",
  );
});

test('create a task: title, project by name, due date, description', async (t) => {
  const w = await world(t);
  const created = await w.fake.sceneAction('create_task', {
    title: '  Vérifier les détecteurs de fumée ',
    project: 'maison',
    due: '+3d',
    description: 'Depuis Gladys',
  });
  assert.equal(created.success, true, JSON.stringify(created));
  assert.deepEqual(created.data.outputs, {
    task: 'Vérifier les détecteurs de fumée',
    task_id: '13',
    url: `${URL_1}/tickets/showTicket/13`,
    project_name: 'Maison',
    due_date: '2026-11-25',
  });
  const add = w.server.requests.find((request) => request.method.endsWith('addTicket'));
  assert.deepEqual(add.params, {
    values: {
      headline: 'Vérifier les détecteurs de fumée',
      type: 'task',
      projectId: 1,
      description: 'Depuis Gladys',
      dateToFinish: '2026-11-25',
    },
  });
  assert.equal(w.fake.lastState(projectId(w.gladys, PROJECTS.MAISON).feature('open')), 6);
  const first = await w.fake.sceneAction('create_task', { title: 'Sans projet' });
  assert.equal(first.data.outputs.project_name, 'Jardin', 'the first followed project');
  assert.equal(first.data.outputs.due_date, '');
});

test('create a task: the errors are red, in four languages', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, language: 'fr' } });
  const fail = async (fields) => {
    const ack = await w.fake.sceneAction('create_task', fields);
    assert.equal(ack.success, false);
    assert.deepEqual(Object.keys(ack.error), ['en', 'fr', 'de', 'es']);
    return ack.error.fr;
  };
  assert.match(await fail({ title: ' ' }), /Indiquez le titre/);
  assert.match(await fail({ title: 'x', due: 'demain' }), /Échéance incomprise/);
  assert.match(await fail({ title: 'x', due: '2026-02-30' }), /Échéance incomprise/);
  assert.match(await fail({ title: 'x', project: 'potager' }), /Aucun projet/);
  w.server.failure = {
    status: 200,
    body: JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'You are not allowed to perform this action.' },
      id: 1,
    }),
  };
  assert.match(
    await fail({ title: 'x', project: 'maison' }),
    /^Leantime : la clé d'API n'a pas ce droit/,
  );
  w.server.failure = null;
  await w.fake.configUpdated({ ...BASE_CONFIG, language: 'fr', projects: '' });
  assert.match(await fail({ title: 'x' }), /Indiquez le projet/);
});

test('read today: the sentence, per project, of one assignee', async (t) => {
  const w = await world(t);
  const all = await w.fake.sceneAction('read_today', {});
  assert.deepEqual(all.data.outputs, {
    text: '4 task(s) due by tonight: Tailler la haie, Sortir les poubelles, Payer la cantine and Arroser les plantes. 2 overdue.',
    count: 4,
    overdue: 2,
  });
  const ada = await w.fake.sceneAction('read_today', {
    project: 'maison',
    assignee: ' ada  ADMIN',
  });
  assert.equal(
    ada.data.outputs.text,
    '2 task(s) due by tonight: Sortir les poubelles and Payer la cantine. 1 overdue.',
  );
  const none = await w.fake.sceneAction('read_today', { project: 'jardin', assignee: 'Ada Admin' });
  assert.equal(none.data.outputs.text, 'No task due today.');
  const unknown = await w.fake.sceneAction('read_today', { project: 'potager' });
  assert.equal(unknown.success, false);
});

test('the state under /data holds no secret and no name', async (t) => {
  const w = await world(t);
  await w.hub.store.flush();
  const saved = await readFile(join(w.dataDir, 'leantime-state.json'), 'utf8');
  assert.deepEqual(Object.keys(JSON.parse(saved)), ['scope', 'readAt', 'assigned', 'sent']);
  assert.doesNotMatch(saved, /lt_|FakeKey|Sortir|Maison|Ada/);
  assert.deepEqual(JSON.parse(saved).assigned, { 9: '4', 5: '1', 3: '4', 2: '1', 1: '1' });
});

test('a configuration change during a reading: the old answer is dropped', async (t) => {
  const w = await world(t);
  const other = { ...BASE_CONFIG, projects: '' };
  const reading = w.hub.poll();
  await w.fake.configUpdated(other);
  await reading;
  assert.equal(w.hub.followed.length, 0);
});

test('a device created in Gladys gets its states again', async (t) => {
  const w = await world(t);
  const before = w.fake.states.length;
  await w.fake.deviceCreated(w.fake.discoveredDevices[0]);
  assert.ok(w.fake.states.length >= before + 5);
});
