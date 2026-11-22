// -----------------------------------------------------------------------------
// The "today's tasks" widget: content within the core budget (validated by
// the SDK's validateWidgetContent), the instance and one-project views, one
// assignee, and the degraded states.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { BASE_CONFIG, PROJECTS, createWorld, instanceId, projectId } from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet('tasks_today', {
    settings,
    language,
    units: 'metric',
  });
  assert.equal(ack.success, true, ack.error);
  const { content: tree } = ack.data;
  assert.deepEqual(validateWidgetContent(tree), [], 'within the core vocabulary and budget');
  return tree;
}

const ofType = (data, type) => data.components.filter((component) => component.type === type);
const rows = (data) =>
  ofType(data, 'status')[0].items.map((row) => [row.label, row.value, row.color]);

test('the instance: tiles, the tasks of the day with their project', async (t) => {
  const w = await world(t);
  const data = await content(w);
  assert.ok(data.components.length <= 8);
  assert.deepEqual(
    ofType(data, 'value').map((tile) => tile.value),
    [2, 2],
  );
  assert.deepEqual(rows(data), [
    ['Tailler la haie', 'Fri 20 Nov · Jardin', 'danger'],
    ['Sortir les poubelles', 'Sat 21 Nov · Maison', 'danger'],
    ['Payer la cantine', 'Today · Maison', 'neutral'],
    ['Arroser les plantes', 'Today · Maison', 'neutral'],
  ]);
  assert.equal(ofType(data, 'button').length, 0);
});

test('the instance device chosen explicitly is the same view', async (t) => {
  const w = await world(t);
  const data = await content(w, { device: instanceId(w.gladys).device });
  assert.equal(rows(data).length, 4);
});

test('one project, one assignee, in French; the name given in Gladys', async (t) => {
  const w = await world(t);
  const device = projectId(w.gladys, PROJECTS.MAISON).device;
  const data = await content(w, { device, assignee: 'Ada Admin' }, 'fr');
  assert.deepEqual(rows(data), [
    ['Sortir les poubelles', 'sam. 21 nov.', 'danger'],
    ['Payer la cantine', "Aujourd'hui", 'neutral'],
  ]);
  assert.deepEqual(
    ofType(data, 'value').map((tile) => [tile.label, tile.value]),
    [
      ["Aujourd'hui", 1],
      ['En retard', 1],
    ],
  );
  const created = w.fake.discoveredDevices.find((item) => item.external_id === device);
  await w.fake.deviceCreated({ ...created, name: 'Travaux maison' });
  const named = await content(w);
  assert.equal(rows(named)[1][1], 'Sat 21 Nov · Travaux maison');
});

test('nothing due: a sentence and the next milestone', async (t) => {
  const w = await world(t);
  for (const id of [1, 2, 3, 8]) {
    w.server.update(id, { status: 0 });
  }
  await w.hub.poll();
  const data = await content(w);
  assert.equal(ofType(data, 'text')[0].text, 'No task due today.');
  assert.deepEqual(rows(data), [['Fin des travaux', 'Milestone · Fri 27 Nov', 'neutral']]);
});

test('degraded states: not configured, never read, no longer followed, stale', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, api_key: '' } });
  assert.match(ofType(await content(w), 'text')[0].text, /API key/);
  await w.fake.configUpdated(BASE_CONFIG);
  const unknown = await content(w, { device: projectId(w.gladys, '99').device });
  assert.match(ofType(unknown, 'text')[0].text, /no longer followed/);
  w.server.failure = Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
  await w.hub.poll();
  const stale = await content(w);
  assert.match(ofType(stale, 'text')[0].text, /last known tasks/);
  assert.equal(rows(stale).length, 4);
  const never = await world(t, { config: { ...BASE_CONFIG, url: 'http://198.51.100.7' } });
  assert.match(ofType(await content(never), 'text')[0].text, /does not answer/);
});

test('ten rows at most', async (t) => {
  const w = await world(t);
  for (let i = 0; i < 12; i += 1) {
    w.server.tickets.push({
      ...structuredClone(w.server.find(2)),
      id: 100 + i,
      headline: `Tâche ${i}`,
    });
  }
  await w.hub.poll();
  const data = await content(w);
  assert.equal(rows(data).length, 10);
  assert.equal(ofType(data, 'value')[0].value, 14);
});
