// -----------------------------------------------------------------------------
// The Leantime hub: reads the instance on a timer of the container, publishes
// the counters of the instance and of every followed project when they
// change, fires the scene events (a task assigned to someone, a task whose
// due day ends while it is still open), and creates tasks for the scene
// action.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 10 minutes, beyond the fixed list of the core scheduler, and the scene
// events must fire even when no device was added. The timer also wakes up at
// local midnight, so the "overdue" events and the counters move on time
// whatever the interval.
// (Architecture adapted from guim31/gladys-openproject.)
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { hostOf, isLocalAddress } from './config.js';
import { buildDevice, featureStates, instanceIds, projectIds } from './devices.js';
import { ERROR_KINDS, LeantimeClient, LeantimeError } from './leantime/client.js';
import {
  addDays,
  findByIdOrName,
  fold,
  localDay,
  parseProjects,
  parseTickets,
  resolveTimeZone,
  summarize,
} from './leantime/model.js';
import {
  ACTION_TEXT,
  ActionFailure,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  TODAY_TEXT,
  UNKNOWN_PROJECTS,
  allLanguages,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'leantime-hub' });

export const WIDGET_KEY = 'tasks_today';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  ASSIGNED: 'task_assigned',
  OVERDUE: 'task_overdue',
});

export const HUB_TIMINGS = {
  // A failed read is tried again this soon, whatever the interval.
  retryMs: 30_000,
  // Read this long after midnight, so the server agrees on the day.
  wakeSlackMs: 2_000,
  // Never read more often than this.
  minDelayMs: 10_000,
  // Re-send unchanged values this often: Gladys shows "no recent value" after 48 h.
  heartbeatMs: 12 * 60 * 60_000,
  // An event this late (Leantime or the integration was down) is dropped.
  maxLateMs: 60 * 60_000,
  // The statuses of a project are read again after this long.
  labelsMs: 60 * 60_000,
};

// At most this many projects get a device.
export const MAX_PROJECTS = 20;
// The reading after a command is awaited at most this long: the scene action
// answers within its 20 s.
const REFRESH_WAIT_MS = 3_000;
// Names read out by the "Read today's tasks" action.
const MAX_NAMES = 10;
// Leantime's column for a title is a VARCHAR(255).
const MAX_TITLE = 255;
const MAX_DESCRIPTION = 5_000;
// "Assigned" events sent by one reading at most; the others are taken as known.
const MAX_ASSIGNED_EVENTS = 20;
// "Read today's tasks" answers from a reading this recent, without reading again.
const FRESH_MS = 60_000;
// …and waits at most this long for a new one (the scene action has 20 s).
const READ_WAIT_MS = 12_000;

const EMPTY = () => ({ projects: [], tickets: [] });

export class LeantimeHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/leantime/http.js)
   * @param {boolean} [options.timers] periodic timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   * @param {string} [options.timeZone] defaults to TZ, set by the Gladys supervisor
   */
  constructor({ gladys, store, request, timers = true, timings, now, timeZone }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.timeZone = resolveTimeZone(timeZone ?? process.env.TZ);
    this.config = null;
    this.client = null;
    this.reset();
    this.saved = { scope: null, readAt: 0, assigned: {}, projects: [], sent: [] };
    this.connection = null;
    this.devicesSignature = null;
    this.widgetSignature = null;
    this.transports = new Map();
    this.timer = null;
    this.polling = null;
    this.stopped = false;
  }

  reset() {
    /** The last reading (see EMPTY). */
    this.data = EMPTY();
    /** The statuses of each project, `{ at, labels }`, by project id. */
    this.labels = new Map();
    /** The followed projects, `{ id, name }`. */
    this.followed = [];
    this.unknownProjects = [];
    this.error = null;
    this.downSince = null;
    this.readAt = 0;
    this.connectedLogged = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (connected, lost, back, user commands). A
  // problem that repeats is logged once, then at debug until it clears.

  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  get language() {
    return this.config?.language ?? 'en';
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    const assigned =
      saved.assigned && typeof saved.assigned === 'object' && !Array.isArray(saved.assigned)
        ? Object.fromEntries(Object.entries(saved.assigned).map(([id, user]) => [id, String(user)]))
        : {};
    this.saved = {
      scope: typeof saved.scope === 'string' ? saved.scope : null,
      readAt: Number.isFinite(saved.readAt) ? saved.readAt : 0,
      assigned,
      projects: Array.isArray(saved.projects) ? saved.projects.map(String) : [],
      sent: Array.isArray(saved.sent) ? saved.sent : [],
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.connection = null;
    this.devicesSignature = null;
    this.transports.clear();
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const same =
      previous &&
      previous.url === config.url &&
      previous.apiKey === config.apiKey &&
      previous.allowSelfSigned === config.allowSelfSigned;
    if (!same) {
      this.reset();
      this.transports.clear();
      this.client =
        config.url && config.apiKey
          ? new LeantimeClient({
              url: config.url,
              apiKey: config.apiKey,
              insecure: config.allowSelfSigned,
              request: this.request,
            })
          : null;
    }
    // A new language or project list: the devices are published again.
    this.devicesSignature = null;
    this.gladys.forgetPublishedStates?.();
    await this.poll();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.polling?.catch(() => {});
    await this.store.flush();
  }

  schedule(delay) {
    clearTimeout(this.timer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.timer = setTimeout(() => {
      this.poll().catch((err) => this.problem('poll', 'Reading failed', err, 'error'));
    }, delay);
  }

  /** The interval, shortened to the next local midnight. */
  nextDelay(readAt = this.now()) {
    if (this.error) {
      return Math.min(this.config.pollIntervalMs, this.timings.retryMs);
    }
    // `readAt`: a midnight that passed during the reading is still ahead of it.
    const wake = Math.max(
      0,
      localDay(readAt, this.timeZone).end - this.now() + this.timings.wakeSlackMs,
    );
    return Math.max(this.timings.minDelayMs, Math.min(this.config.pollIntervalMs, wake));
  }

  // --- Reading ---------------------------------------------------------------

  /** One reading at a time: a call during a reading waits for it, then reads. */
  poll() {
    const run = async () => {
      const readAt = this.now();
      try {
        await this.read();
      } finally {
        this.schedule(this.nextDelay(readAt));
      }
    };
    this.polling = (this.polling ?? Promise.resolve()).catch(() => {}).then(run);
    return this.polling;
  }

  /** The statuses of the projects of these tickets, cached for an hour. */
  async readLabels(client, items, now) {
    const ids = [...new Set(items.map((item) => String(item?.projectId ?? '')))].filter((id) =>
      /^\d+$/.test(id),
    );
    const labels = new Map();
    for (const id of ids) {
      const cached = this.labels.get(id);
      if (cached && now - cached.at < this.timings.labelsMs) {
        labels.set(id, cached.labels);
        continue;
      }
      try {
        const read = await client.statusLabels(id);
        this.labels.set(id, { at: now, labels: read });
        labels.set(id, read);
      } catch (err) {
        if (!(err instanceof LeantimeError) || err.kind !== ERROR_KINDS.FORBIDDEN) {
          throw err;
        }
        // A key that sees a project's tickets but not its statuses: Leantime's
        // default statuses (0 Done, -1 Archived) are assumed.
        this.labels.set(id, { at: now, labels: {} });
        labels.set(id, {});
      }
    }
    return labels;
  }

  /**
   * Three requests (and one per project for its statuses, once an hour), one
   * after the other: a small server is not hit at once.
   */
  async fetch(client, now) {
    const projects = parseProjects(await client.projects());
    const day = localDay(now, this.timeZone);
    // NOT_DONE: every status but the "Done" ones, "don't report" (NONE) included.
    const open = await client.tickets({ statusType: 'NOT_DONE' });
    const done = await client.tickets({
      statusType: 'DONE',
      // Leantime refuses milliseconds (-32602 "must be an ISO 8601 datetime").
      modifiedAfter: new Date(day.start).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    });
    // An older Leantime ignores both filters and answers every ticket: the
    // statuses of each project sort them again.
    const labels = await this.readLabels(client, [...open, ...done], now);
    const tickets = parseTickets([...open, ...done], { timeZone: this.timeZone, labels });
    return { projects, tickets };
  }

  async read() {
    if (!this.client) {
      await this.publishConnectionStatus();
      return;
    }
    const now = this.now();
    const { client } = this;
    try {
      const data = await this.fetch(client, now);
      if (client !== this.client) {
        // The configuration changed during the reading: this is the old
        // instance; the new one is being read.
        return;
      }
      this.data = data;
      this.followed = this.follow(data.projects);
      this.readAt = now;
      this.recovered(now);
    } catch (err) {
      if (client !== this.client) {
        return;
      }
      this.failed(err, now);
    }
    if (this.readAt !== 0) {
      await this.publishDevices();
      // The configuration may change while Gladys answers: never write the
      // old reading's events under the new one.
      if (!this.error && client === this.client) {
        await this.publishStates();
        if (client === this.client) {
          await this.fireEvents(now);
        }
      }
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.refreshWidget();
  }

  /** The projects with a device: the configuration's list (names or ids). */
  follow(projects) {
    const unknown = [];
    const found = new Set();
    for (const query of this.config.projects) {
      const { item, reason } = findByIdOrName(projects, query);
      if (item) {
        found.add(item.id);
      } else if (reason === 'ambiguous') {
        // Two projects of that name: both are followed.
        for (const project of projects) {
          if (findByIdOrName([project], query).item) {
            found.add(project.id);
          }
        }
      } else {
        unknown.push(query);
      }
    }
    let followed = projects.filter((project) => found.has(project.id));
    if (followed.length > MAX_PROJECTS) {
      this.problem(
        'too-many-projects',
        `${followed.length} projects: only the first ${MAX_PROJECTS} get a device`,
      );
      followed = followed.slice(0, MAX_PROJECTS);
    } else {
      this.resolved('too-many-projects');
    }
    if (unknown.join('|') !== this.unknownProjects.join('|')) {
      this.unknownProjects = unknown;
      if (unknown.length > 0) {
        logger.warn(UNKNOWN_PROJECTS.en(unknown.join(', ')));
      }
    }
    return followed;
  }

  recovered(now) {
    const host = hostOf(this.config.url);
    if (this.downSince !== null) {
      const minutes = Math.round((now - this.downSince) / 60_000);
      this.resolved('read', `Leantime at ${host} answers again after ${minutes} min`);
    }
    if (!this.connectedLogged) {
      this.connectedLogged = true;
      logger.info(
        `Connected to Leantime at ${host}: ${this.data.projects.length} project(s), ${this.followed.length} followed`,
      );
    }
    this.error = null;
    this.downSince = null;
  }

  failed(err, now) {
    const kind = err instanceof LeantimeError ? err.kind : ERROR_KINDS.HTTP;
    this.error = { kind, message: err.message };
    this.downSince ??= now;
    this.problem(
      'read',
      `Leantime at ${hostOf(this.config.url)}: ${err.message}`,
      undefined,
      'error',
    );
  }

  /** What a device external id points at: `{ projectId }` (null: the instance), or null. */
  scopeOf(externalId) {
    if (externalId === instanceIds(this.gladys).device) {
      return { projectId: null };
    }
    const project = this.followed.find(
      (item) => projectIds(this.gladys, item.id).device === externalId,
    );
    return project ? { projectId: project.id } : null;
  }

  /** What a widget points at: the instance, or one followed project. */
  view(deviceExternalId) {
    if (!deviceExternalId) {
      return { projectId: null, unknown: false };
    }
    const scope = this.scopeOf(deviceExternalId);
    return { projectId: scope?.projectId ?? null, unknown: !scope };
  }

  /**
   * The counters of the instance (`projectId` null) or of one project.
   * @param {string|null} [projectId]
   * @param {{ assignee?: string }} [options] only the tasks of the user of this name
   */
  summary(projectId = null, { assignee = '' } = {}) {
    const day = localDay(this.now(), this.timeZone);
    let tickets = this.data.tickets.filter(
      (item) => projectId === null || item.projectId === projectId,
    );
    const wanted = fold(assignee ?? '');
    if (wanted) {
      // Milestones stay: they belong to everyone.
      tickets = tickets.filter((item) => item.milestone || fold(item.assignee) === wanted);
    }
    return summarize(tickets, day);
  }

  projectTitle(projectId) {
    return this.data.projects.find((project) => project.id === projectId)?.name ?? '';
  }

  /** The name of the project in Gladys once its device is added, else in Leantime (the widget). */
  shownProjectName(projectId) {
    const externalId = projectIds(this.gladys, projectId).device;
    const device = (this.gladys.devices ?? []).find((item) => item.external_id === externalId);
    return device?.name || this.projectTitle(projectId);
  }

  ticketUrl(id) {
    return `${this.config.url}/tickets/showTicket/${id}`;
  }

  // --- Publishing to Gladys --------------------------------------------------

  devices() {
    // Two projects of the same name: the number tells them apart.
    const names = new Map();
    for (const project of this.followed) {
      names.set(project.name, (names.get(project.name) ?? 0) + 1);
    }
    return [
      buildDevice(this.gladys, null, this.language),
      ...this.followed.map((project) => {
        const name =
          names.get(project.name) > 1
            ? `${project.name.slice(0, 40)} (#${project.id})`
            : project.name;
        return buildDevice(this.gladys, { ...project, name }, this.language);
      }),
    ];
  }

  async publishDevices() {
    const devices = this.devices();
    const signature = JSON.stringify(devices);
    if (signature === this.devicesSignature) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.devicesSignature = signature;
      this.resolved('devices');
    } catch (err) {
      this.problem('devices', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab. */
  async rediscover() {
    this.devicesSignature = null;
    await this.poll();
  }

  /** The user added a device: the states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    this.gladys.forgetPublishedStates?.(device?.external_id);
    if (!this.error && this.readAt !== 0) {
      await this.publishStates();
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  states() {
    const options = { language: this.language, timeZone: this.timeZone };
    return [null, ...this.followed.map((project) => project.id)].flatMap((projectId) =>
      featureStates(this.gladys, projectId, this.summary(projectId), options),
    );
  }

  async publishStates() {
    try {
      // Only the changes, and every value again after `heartbeatMs`.
      await this.gladys.publishChangedStates(this.states(), {
        heartbeat: this.timings.heartbeatMs,
      });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States refused: ${err.message}`);
    }
  }

  async publishTransports() {
    if (this.readAt === 0) {
      return;
    }
    let transport = DEVICE_TRANSPORTS.UNREACHABLE;
    if (!this.error) {
      transport = isLocalAddress(this.config.url)
        ? DEVICE_TRANSPORTS.LOCAL
        : DEVICE_TRANSPORTS.CLOUD;
    }
    const entries = this.devices()
      .map((device) => ({ external_id: device.external_id, transport }))
      .filter((entry) => this.transports.get(entry.external_id) !== entry.transport);
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  connectionStatus() {
    if (!this.config.url) {
      return {
        connected: false,
        message: this.config.urlTyped ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noUrl,
      };
    }
    if (!this.client) {
      return { connected: false, message: CONNECTION_TEXT.noApiKey };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  refreshWidget() {
    const signature = JSON.stringify([
      this.error?.kind ?? null,
      this.followed,
      this.data.tickets
        .filter((item) => item.open && !item.milestone && item.dueAt !== null)
        .map((item) => [item.id, item.name, item.dueAt, item.projectId, item.assignee]),
      this.data.tickets
        .filter((item) => item.milestone && item.open)
        .map((item) => [item.id, item.name, item.dueAt, item.projectId]),
      localDay(this.now(), this.timeZone).start,
    ]);
    if (signature !== this.widgetSignature) {
      this.widgetSignature = signature;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  // --- Scene events ----------------------------------------------------------

  /**
   * The events since the previous successful reading (persisted under /data,
   * so a restart neither repeats nor loses one):
   *   - an open task now assigned to someone it was not assigned to then
   *     (assigned, reassigned, created with an assignee, or reopened);
   *   - the end of the due day of an open task crossed since the previous
   *     reading (at most `maxLateMs` ago). A due date set by hand to a day
   *     already over fires nothing.
   */
  async fireEvents(now) {
    // Another key on the same instance sees other projects: its tasks are not news.
    const key = createHash('sha256').update(this.config.apiKey).digest('hex').slice(0, 12);
    const scope = `${this.config.url}#${key}`;
    const projects = this.data.projects.map((project) => project.id);
    const current = Object.fromEntries(
      this.data.tickets
        .filter((item) => item.open && !item.milestone && item.assigneeId)
        .map((item) => [item.id, item.assigneeId]),
    );
    if (this.saved.scope !== scope || this.saved.readAt === 0) {
      // First reading of this instance: what already passed is not news.
      this.saved = { scope, readAt: now, assigned: current, projects, sent: [] };
      this.store.save(this.saved);
      return;
    }
    const known = this.saved.assigned;
    // A project newly visible (given to the key since): its tasks are not news either.
    const seen = new Set(this.saved.projects);
    let budget = MAX_ASSIGNED_EVENTS;
    // Overdue events already sent at the moment where Gladys refused one.
    const sent = new Set(this.saved.sent);
    const eventId = (event) => `${event.item.id}:${event.at}`;
    const from = Math.max(this.saved.readAt, now - this.timings.maxLateMs);
    const crossed = (moment) => moment > from && moment <= now;
    // Gladys refused (restarting?): an assignment is tried again at the next
    // reading (its previous assignee is kept); an overdue event and the next
    // ones too, within the hour (the time of the reading stays before it).
    const kept = { ...current };
    for (const item of this.data.tickets) {
      if (!item.open || item.milestone || !item.assigneeId || known[item.id] === item.assigneeId) {
        continue;
      }
      if (!seen.has(item.projectId) || budget <= 0) {
        continue;
      }
      budget -= 1;
      if (!(await this.fire(TRIGGERS.ASSIGNED, this.eventData(item)))) {
        if (known[item.id] === undefined) {
          delete kept[item.id];
        } else {
          kept[item.id] = known[item.id];
        }
      }
    }
    const events = [];
    for (const item of this.data.tickets) {
      if (!item.open || item.milestone || item.dueAt === null) {
        continue;
      }
      const dayEnd = localDay(item.dueAt, this.timeZone).end;
      if (crossed(dayEnd)) {
        events.push({ at: dayEnd, item });
      }
    }
    events.sort((a, b) => a.at - b.at || Number(a.item.id) - Number(b.item.id));
    let readAt = now;
    let sentNow = [];
    for (const event of events) {
      if (sent.has(eventId(event))) {
        sentNow.push(eventId(event));
        continue;
      }
      if (!(await this.fire(TRIGGERS.OVERDUE, this.eventData(event.item)))) {
        readAt = event.at - 1;
        // Those of the same moment already sent are not sent again.
        sentNow = sentNow.filter((id) => id.endsWith(`:${event.at}`));
        break;
      }
      sentNow.push(eventId(event));
    }
    if (readAt === now) {
      sentNow = [];
    }
    this.saved = {
      scope,
      readAt: Math.max(readAt, this.saved.readAt),
      assigned: kept,
      projects,
      sent: sentNow,
    };
    this.store.save(this.saved);
  }

  eventData(item) {
    return {
      task: item.name,
      task_id: item.id,
      project: projectIds(this.gladys, item.projectId).device,
      project_name: item.projectName || this.projectTitle(item.projectId),
      type: item.type,
      status: item.status,
      assignee: item.assignee,
      due_date: item.dueDay ?? '',
      url: this.ticketUrl(item.id),
    };
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
      return true;
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
      return false;
    }
  }

  // --- Commands --------------------------------------------------------------

  /** A Leantime error, in words for the user (the server's text stays in the logs). */
  explain(err) {
    if (err instanceof ActionFailure || !(err instanceof LeantimeError)) {
      return err;
    }
    const status = err.status && err.status !== 200 ? ` (HTTP ${err.status})` : '';
    // Refused values carry Leantime's reason ("statusType must be…").
    const detail = err.kind === ERROR_KINDS.INVALID && err.detail ? ` ${err.detail}` : '';
    return new ActionFailure(
      allLanguages((language) => {
        const colon = language === 'fr' ? ' : ' : ': ';
        return `Leantime${colon}${pick(ERROR_TEXT[err.kind], language)}${status}${detail}`.slice(
          0,
          500,
        );
      }),
    );
  }

  fail(key) {
    return new ActionFailure(ACTION_TEXT[key]);
  }

  requireClient() {
    if (!this.client) {
      throw this.fail('notConfigured');
    }
    return this.client;
  }

  /** Read again now, and wait for it a little (the answer should not lag). */
  async refreshSoon() {
    const refresh = this.poll().catch(() => {});
    let timer;
    await Promise.race([
      refresh,
      new Promise((resolve) => {
        timer = setTimeout(resolve, REFRESH_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
  }

  /** A project by id or name; empty: the first followed one. */
  findProject(projects, query) {
    if (String(query ?? '').trim() === '') {
      const first = this.followed[0] ?? null;
      if (!first) {
        throw this.fail('noProject');
      }
      return first;
    }
    const { item, reason } = findByIdOrName(projects, query);
    if (!item) {
      throw this.fail(reason === 'ambiguous' ? 'projectAmbiguous' : 'projectNotFound');
    }
    return item;
  }

  /**
   * The due date typed in a scene: `YYYY-MM-DD` (or the day of an ISO 8601
   * date and time), or from today, `+3d` (`j` for jours too). Empty: none.
   * @returns {string|null} `YYYY-MM-DD`
   */
  parseDue(raw) {
    const value = String(raw ?? '').trim();
    if (value === '') {
      return null;
    }
    const relative = value.match(/^\+\s*(\d{1,4})\s*(d|j)$/i);
    if (relative) {
      return addDays(this.now(), Number(relative[1]), this.timeZone);
    }
    const day = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
    if (day) {
      const [, y, m, d] = day.map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      if (date.getUTCMonth() === m - 1 && date.getUTCDate() === d) {
        return value.slice(0, 10);
      }
    }
    throw this.fail('badDue');
  }

  /** Create a task in a project (by name or id; empty: the first followed one). */
  async createTask({ project: projectQuery, title: rawTitle, due, description: rawDescription }) {
    const client = this.requireClient();
    const title = String(rawTitle ?? '')
      .trim()
      .slice(0, MAX_TITLE);
    if (!title) {
      throw this.fail('emptyTitle');
    }
    const dueDate = this.parseDue(due);
    const description = String(rawDescription ?? '')
      .trim()
      .slice(0, MAX_DESCRIPTION);
    let project;
    let id;
    try {
      const projects =
        this.readAt !== 0 && !this.error
          ? this.data.projects
          : parseProjects(await client.projects());
      try {
        project = this.findProject(projects, projectQuery);
      } catch (err) {
        if (projects !== this.data.projects || String(projectQuery ?? '').trim() === '') {
          throw err;
        }
        // A project created in Leantime since the last reading.
        project = this.findProject(parseProjects(await client.projects()), projectQuery);
      }
      id = await client.addTicket({
        projectId: project.id,
        headline: title,
        description,
        dateToFinish: dueDate ?? undefined,
      });
    } catch (err) {
      throw this.explain(err);
    }
    logger.info(`Task ${id} created in project ${project.id} from Gladys`);
    await this.refreshSoon();
    return {
      task: title,
      task_id: String(id),
      url: this.ticketUrl(id),
      project_name: project.name,
      due_date: dueDate ?? '',
    };
  }

  /**
   * Today's tasks, as a sentence for a message or a voice announcement, for
   * the instance or one project (id or name), optionally of one assignee.
   */
  async today({ project: projectQuery, assignee } = {}) {
    this.requireClient();
    if (this.error || this.readAt === 0 || this.now() - this.readAt > FRESH_MS) {
      let timer;
      await Promise.race([
        this.poll().catch(() => {}),
        new Promise((resolve) => {
          timer = setTimeout(resolve, READ_WAIT_MS);
        }),
      ]);
      clearTimeout(timer);
    }
    if (this.error || this.readAt === 0) {
      throw this.explain(
        new LeantimeError(this.error?.kind ?? ERROR_KINDS.UNREACHABLE, this.error?.message ?? ''),
      );
    }
    let projectId = null;
    if (String(projectQuery ?? '').trim() !== '') {
      const { item, reason } = findByIdOrName(this.data.projects, projectQuery);
      if (!item) {
        throw this.fail(reason === 'ambiguous' ? 'projectAmbiguous' : 'projectNotFound');
      }
      projectId = item.id;
    }
    const summary = this.summary(projectId, { assignee: String(assignee ?? '') });
    const texts = TODAY_TEXT[this.language] ?? TODAY_TEXT.en;
    const total = summary.overdue + summary.dueToday;
    const names = summary.agenda.slice(0, MAX_NAMES).map((item) => item.name);
    const more = total - names.length;
    if (more > 0) {
      names.push(`+${more}`);
    }
    const text =
      total === 0
        ? texts.none
        : texts.list(total, names) + (summary.overdue > 0 ? texts.overdue(summary.overdue) : '');
    return {
      text: text.slice(0, 1000),
      count: total,
      overdue: summary.overdue,
    };
  }

  /** The "Test the connection" action: read now, report. */
  async testConnection() {
    await this.poll();
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new ActionFailure(
        allLanguages((language) => REPORT_TEXT[language].failed(pick(status.message, language))),
      );
    }
    const open = this.summary(null).open;
    return allLanguages((language) => {
      const unknown =
        this.unknownProjects.length > 0
          ? ` ${UNKNOWN_PROJECTS[language](this.unknownProjects.join(', '))}`
          : '';
      return `${REPORT_TEXT[language].ok(
        open,
        this.data.projects.length,
        this.followed.length,
      )}${unknown}`;
    });
  }
}
