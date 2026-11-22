// -----------------------------------------------------------------------------
// Leantime JSON-RPC 2.0 client: the calls the integration needs. Checked
// against a real leantime/leantime 3.15.3 (with MariaDB 11) in Docker,
// November 2026.
//
// Authentication: an API key ("Company settings → API keys"; it acts as a
// user of its own, with a role and the projects it is given), sent in the
// `x-api-key` header. Nothing else is kept.
//
//   POST /api/jsonrpc  { jsonrpc: "2.0", id, method: "leantime.rpc.<Domain>.<Service>.<method>", params }
//     Projects.Projects.getAll                          [{ id, name, state, type }]
//     Tickets.Tickets.getAll { searchCriteria }        [{ id, headline, type, status, projectId, … }]
//     Tickets.Tickets.getStatusLabels { projectId }    { "<status>": { name, statusType } }
//     Tickets.Tickets.addTicket { values }             new id (a number), or { msg, type: "error" }
//
// Pitfalls found on the real server are in CLAUDE.md ("Leantime").
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // API key refused (HTTP 401)
  FORBIDDEN: 'forbidden', // the key's role or projects do not allow it (-32001)
  INVALID: 'invalid', // Leantime refused the values (its message is kept)
  NOT_LEANTIME: 'not_leantime', // something answers, but not the JSON-RPC API
  UNSUPPORTED: 'unsupported', // a method this Leantime does not have (too old)
  REDIRECT: 'redirect', // HTTP redirected to HTTPS, or a login portal
  RATE_LIMIT: 'rate_limit', // 429: a reverse proxy's request limit
  HTTP: 'http', // any other unexpected answer
});

export class LeantimeError extends Error {
  constructor(kind, message, status, detail = '') {
    super(message);
    this.name = 'LeantimeError';
    this.kind = kind;
    this.status = status;
    /** Leantime's own explanation of refused values, shown to the user. */
    this.detail = detail;
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function networkError(err) {
  if (TLS_CODES.has(err.code)) {
    return new LeantimeError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
  }
  return new LeantimeError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
}

// JSON-RPC error codes Leantime answers.
const RPC_FORBIDDEN = -32001;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;

export class LeantimeClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, without trailing slash
   * @param {string} options.apiKey
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {Function} [options.request] HTTP seam (src/leantime/http.js)
   */
  constructor({ url, apiKey = '', insecure = false, request }) {
    this.url = url;
    this.apiKey = apiKey;
    this.insecure = insecure;
    this.request = request ?? httpRequest;
    this.id = 0;
  }

  /** One JSON-RPC call; returns its `result`. */
  async call(method, params = {}) {
    this.id += 1;
    let response;
    try {
      response = await this.request(`${this.url}/api/jsonrpc`, {
        method: 'POST',
        json: { jsonrpc: '2.0', id: this.id, method: `leantime.rpc.${method}`, params },
        insecure: this.insecure,
        headers: { 'x-api-key': this.apiKey },
      });
    } catch (err) {
      throw networkError(err);
    }
    const { status, body } = response;
    if (status === 429) {
      throw new LeantimeError(ERROR_KINDS.RATE_LIMIT, 'HTTP 429', status);
    }
    if (status >= 300 && status < 400) {
      throw new LeantimeError(ERROR_KINDS.REDIRECT, `HTTP ${status}`, status);
    }
    // A wrong key: an HTML page "Unauthorized" or `{"error":"Unauthorized"}`.
    if (status === 401) {
      throw new LeantimeError(ERROR_KINDS.AUTH, 'HTTP 401', status);
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      // Another server, the web app, or Leantime's "update the database" page.
      throw new LeantimeError(
        status >= 500 ? ERROR_KINDS.HTTP : ERROR_KINDS.NOT_LEANTIME,
        `HTTP ${status}, not the Leantime API`,
        status,
      );
    }
    if (parsed?.jsonrpc !== '2.0' || typeof parsed !== 'object') {
      throw new LeantimeError(
        status >= 500 ? ERROR_KINDS.HTTP : ERROR_KINDS.NOT_LEANTIME,
        `HTTP ${status}, not a JSON-RPC answer`,
        status,
      );
    }
    if (parsed.error) {
      const code = Number(parsed.error.code);
      // The server's own message, short; it never echoes the key.
      const detail =
        typeof parsed.error.message === 'string' ? parsed.error.message.slice(0, 200) : '';
      const message = `JSON-RPC ${code} ${detail}`.trim();
      if (code === RPC_FORBIDDEN) {
        throw new LeantimeError(ERROR_KINDS.FORBIDDEN, message, status);
      }
      if (code === RPC_METHOD_NOT_FOUND) {
        throw new LeantimeError(ERROR_KINDS.UNSUPPORTED, `${message} (${method})`, status);
      }
      if (code === RPC_INVALID_PARAMS) {
        throw new LeantimeError(ERROR_KINDS.INVALID, message, status, detail);
      }
      throw new LeantimeError(ERROR_KINDS.HTTP, message, status);
    }
    if (status < 200 || status >= 300) {
      throw new LeantimeError(ERROR_KINDS.HTTP, `HTTP ${status}`, status);
    }
    return parsed.result;
  }

  /** A call whose result must be a list (Leantime answers `false` for "none"). */
  async list(method, params) {
    const result = await this.call(method, params);
    if (result === false || result === null) {
      return [];
    }
    if (!Array.isArray(result)) {
      throw new LeantimeError(ERROR_KINDS.NOT_LEANTIME, `no list from ${method}`, 200);
    }
    return result;
  }

  /** Every project the key may see (open ones; closed ones are left out by Leantime). */
  projects() {
    return this.list('Projects.Projects.getAll', {});
  }

  /**
   * Tickets (tasks, bugs, subtasks and milestones) of every project the key sees.
   * `statusType` ("NOT_DONE", "DONE") and `modifiedAfter` (ISO 8601)
   * filter on the server since Leantime 3.7 or so; an older one ignores them,
   * so the caller sorts the answer again.
   */
  tickets(searchCriteria) {
    return this.list('Tickets.Tickets.getAll', { searchCriteria });
  }

  /** The statuses of a project: `{ "<status id>": { name, statusType } }`. */
  async statusLabels(projectId) {
    const result = await this.call('Tickets.Tickets.getStatusLabels', {
      projectId: Number(projectId),
    });
    return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  }

  /** Create a task; `dateToFinish` `YYYY-MM-DD` or omitted. Returns its id. */
  async addTicket({ projectId, headline, description, dateToFinish }) {
    const values = {
      headline,
      type: 'task',
      projectId: Number(projectId),
      ...(description ? { description } : {}),
      // A bare `YYYY-MM-DD` is stored as is, without time zone conversion.
      ...(dateToFinish ? { dateToFinish } : {}),
    };
    const result = await this.call('Tickets.Tickets.addTicket', { values });
    if (Number.isInteger(result) && result > 0) {
      return result;
    }
    // `{ msg: "notifications.ticket_save_error_no_headline", type: "error" }`, or `false`.
    const detail = typeof result?.msg === 'string' ? result.msg.slice(0, 200) : '';
    throw new LeantimeError(ERROR_KINDS.INVALID, `ticket refused ${detail}`.trim(), 200, detail);
  }
}
