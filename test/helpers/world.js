// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Leantime on a fake
// network, a temporary /data, a manual clock and the Paris time zone, with
// the integration wired on top through registerHandlers. No timer runs unless
// `timers: true` (with node:test mock timers): the tests read Leantime
// with `world.hub.poll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import {
  API_KEY,
  FakeLeantime,
  PROJECTS,
  STATUSES,
  USERS,
  createNetwork,
  dbTime,
} from './fakeLeantime.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

// A name of the home network: the devices are "local" (src/config.js isLocalAddress).
export const URL_1 = 'http://leantime.lan:8080';
export const TIME_ZONE = 'Europe/Paris';
// The fixtures were captured on 22/11/2026 around 11:48 UTC; the tests start
// at 18:00 UTC (19:00 in Paris, UTC+1), a Sunday. Overdue: "Tailler la haie"
// (20/11), "Sortir les poubelles" (21/11); due today: "Payer la cantine",
// "Arroser les plantes"; done today: "Changer les draps", "Commander du terreau".
export const START = Date.UTC(2026, 10, 22, 18, 0, 0);

export function createClock(start = START) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
    /** Move to a local Paris time (UTC+1 until March). */
    set(isoUtc) {
      clock.time = Date.parse(isoUtc);
    },
  };
  return clock;
}

export const BASE_CONFIG = {
  url: URL_1,
  api_key: API_KEY,
  projects: 'maison, Jardin',
  language: 'en',
};

/**
 * @param {object} [options]
 * @param {FakeLeantime} [options.server]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  clock = createClock(),
  server,
  config = BASE_CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-leantime-')),
  timings = {},
  timers = false,
} = {}) {
  const leantime = server ?? new FakeLeantime();
  leantime.now = clock.now;
  const network = createNetwork({ [URL_1]: leantime });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers,
    timings,
    now: clock.now,
    timeZone: TIME_ZONE,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, server: leantime, app, hub: app.hub, clock, dataDir };
}

export const instanceId = (gladys) => gladys.externalIds('instance', 'instance');
export const projectId = (gladys, id = PROJECTS.MAISON) =>
  gladys.externalIds('project', `project-${id}`);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { API_KEY, FakeLeantime, PROJECTS, STATUSES, USERS, dbTime };
