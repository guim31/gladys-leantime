// -----------------------------------------------------------------------------
// An in-memory Leantime, answering the JSON-RPC calls the integration makes
// the way the real server does (`statusType` and `modifiedAfter` filters,
// JSON-RPC error codes, HTTP 401 on a wrong key, `{ msg, type: "error" }` on
// a ticket without title). Its starting data are real answers of
// leantime/leantime 3.15.3 in Docker (test/fixtures/leantime/real-*.json),
// captured on 22/11/2026 around 11:48 UTC. Two projects, Maison (1) and
// Jardin (2), twelve tickets:
//   - Maison: "Sortir les poubelles" (21/11, Ada), "Payer la cantine" (22/11,
//     Ada), "Arroser les plantes" (22/11, Camille, In progress), "Changer les
//     draps" (22/11, Done today), "Reparer le robinet" (24/11, typed 18:00 in
//     the web app: stored 20:00 UTC, Ada), "Ranger le grenier" (no date),
//     milestone "Fin des travaux" (27/11);
//   - Jardin: "Tailler la haie" (20/11, Blocked), "Tondre la pelouse" (25/11,
//     Camille, a bug), "Commander du terreau" (no date, Done today), milestone
//     "Printemps" (20/03/2027), and an archived one, never answered.
// test/fake-leantime.test.js checks the fake answers the captured calls
// exactly as the real server did.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/leantime/${name}.json`, import.meta.url), 'utf8'));

export const API_KEY = 'lt_FakeKeyUser0001_FakeKeySecret00000000';
export const PROJECTS = Object.freeze({ MAISON: '1', JARDIN: '2' });
export const USERS = Object.freeze({ ADA: '1', CAMILLE: '4' });
export const STATUSES = Object.freeze({
  NEW: 3,
  BLOCKED: 1,
  IN_PROGRESS: 4,
  DONE: 0,
  ARCHIVED: -1,
});

const reply = (status, value) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value),
});

const pad = (n) => String(n).padStart(2, '0');
/** A Leantime UTC date and time, `YYYY-MM-DD HH:MM:SS`. */
export const dbTime = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

export class FakeLeantime {
  constructor() {
    this.projects = fixture('real-projects').result;
    this.labels = fixture('real-status-labels').result;
    // Every ticket but the archived one (Leantime leaves archived ones out).
    this.tickets = fixture('real-all').result.map((item) => structuredClone(item));
    this.nextId = 13;
    /** Requests received, `{ method, params }` (JSON-RPC). */
    this.requests = [];
    /** When set, every request answers this (`{ status, body }` or an Error to throw). */
    this.failure = null;
    this.apiKey = API_KEY;
    /** Projects whose statuses the key may not read (-32001). */
    this.labelsForbidden = new Set();
    /** An older Leantime: the `statusType` and `modifiedAfter` filters are ignored. */
    this.ignoresFilters = false;
    /** The clock of the server, for `modified` (tests set it). */
    this.now = () => Date.UTC(2026, 10, 22, 11, 48);
  }

  // --- Test helpers --------------------------------------------------------------

  find(id) {
    return this.tickets.find((item) => item.id === Number(id));
  }

  /** Change a ticket as a user would in Leantime. */
  update(id, { dateToFinish, editorId, editorFirstname, editorLastname, status } = {}) {
    const item = this.find(id);
    if (dateToFinish !== undefined) item.dateToFinish = dateToFinish;
    if (editorId !== undefined) {
      item.editorId = editorId === null ? '' : String(editorId);
      item.editorFirstname = editorFirstname ?? null;
      item.editorLastname = editorLastname ?? null;
    }
    if (status !== undefined) item.status = status;
    item.modified = dbTime(this.now());
    return item;
  }

  // --- Calls -----------------------------------------------------------------------

  async handle({ method, path, headers, json: body }) {
    if (this.failure instanceof Error) {
      throw this.failure;
    }
    if (this.failure) {
      return { status: this.failure.status, headers: {}, body: this.failure.body };
    }
    if (method !== 'POST' || path !== '/api/jsonrpc') {
      return { status: 404, headers: {}, body: '<!DOCTYPE html><html>Leantime</html>' };
    }
    if (headers?.['x-api-key'] !== this.apiKey) {
      return { status: 401, headers: { 'content-type': 'text/html' }, body: 'Unauthorized' };
    }
    const { id, method: rpc, params = {} } = body ?? {};
    this.requests.push({ method: rpc, params });
    const result = (value) => reply(200, { jsonrpc: '2.0', result: value, id });
    const error = (name) => reply(200, { ...fixture(name), id });
    switch (rpc) {
      case 'leantime.rpc.Projects.Projects.getAll':
        return result(this.projects);
      case 'leantime.rpc.Tickets.Tickets.getStatusLabels':
        return this.labelsForbidden.has(String(params.projectId))
          ? error('real-error-forbidden')
          : result(this.labels);
      case 'leantime.rpc.Tickets.Tickets.getAll':
        return this.getAll(params.searchCriteria ?? {}, { result, error });
      case 'leantime.rpc.Tickets.Tickets.addTicket':
        return this.add(params.values ?? {}, { result, error });
      default:
        return error('real-error-method-not-found');
    }
  }

  getAll(criteria, { result, error }) {
    let found = this.tickets;
    if (this.ignoresFilters) {
      return result(found);
    }
    if (criteria.statusType) {
      const types = String(criteria.statusType).split(',');
      if (!types.every((type) => ['NEW', 'INPROGRESS', 'DONE', 'NOT_DONE'].includes(type))) {
        return error('real-error-invalid-params');
      }
      found = found.filter((item) => types.includes(this.labels[String(item.status)].statusType));
    }
    if (criteria.modifiedAfter) {
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(criteria.modifiedAfter)
      ) {
        return reply(200, {
          jsonrpc: '2.0',
          error: {
            code: -32602,
            message: 'modifiedAfter must be an ISO 8601 datetime (e.g. 2026-07-27T00:00:00Z).',
            data: null,
          },
        });
      }
      const after = Date.parse(criteria.modifiedAfter);
      found = found.filter((item) => Date.parse(`${item.modified.replace(' ', 'T')}Z`) > after);
    }
    return result(found);
  }

  add(values, { result, error }) {
    const project = this.projects.find((item) => item.id === values.projectId);
    if (!project) {
      return error('real-error-forbidden');
    }
    if (!values.headline) {
      return result(fixture('real-add-no-headline').result);
    }
    const template = this.find(6);
    const now = dbTime(this.now());
    const item = {
      ...structuredClone(template),
      id: this.nextId++,
      headline: values.headline,
      description: values.description ?? '',
      type: values.type ?? 'task',
      projectId: project.id,
      projectName: project.name,
      status: STATUSES.NEW,
      statusLabel: 'New',
      dateToFinish: values.dateToFinish ? `${values.dateToFinish} 00:00:00` : '0000-00-00 00:00:00',
      editorId: '',
      editorFirstname: null,
      editorLastname: null,
      date: now,
      modified: now,
    };
    this.tickets.unshift(item);
    return result(item.id);
  }
}

/**
 * A fake network: `request(url, options)` like src/leantime/http.js, routed
 * to the fake server of the URL's origin; any other origin is unreachable.
 */
export function createNetwork(servers) {
  return {
    async request(url, options = {}) {
      const target = new URL(url);
      for (const [base, server] of Object.entries(servers)) {
        const prefix = new URL(base);
        if (target.origin === prefix.origin) {
          const path = target.pathname.slice(prefix.pathname.replace(/\/$/, '').length);
          return server.handle({ ...options, method: options.method ?? 'GET', path });
        }
      }
      const error = new Error(`connect ECONNREFUSED ${target.host}`);
      error.code = 'ECONNREFUSED';
      throw error;
    },
  };
}
