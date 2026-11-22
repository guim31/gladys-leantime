// -----------------------------------------------------------------------------
// From the raw Leantime answers to what Gladys shows: projects, tickets with
// their due day, and the counters of a local day (the time zone of Gladys,
// injected by the supervisor as TZ).
//
// Definitions, the same in the devices, the widget, the scene actions and the
// documentation:
//   - task: a ticket that is not a milestone (task, bug, story, subtask…);
//   - open: its status is not of the "Done" type in its project (Leantime's
//     statusType; "Done" and "Archived" by default);
//   - due day: the "due date" of a task, the end date of a milestone;
//   - overdue: an open task whose due day is over (before today);
//   - due today: an open task whose due day is today;
//   - done today: a task of a "Done" status, last modified today (Leantime
//     keeps no closing date: a done task edited today counts too);
//   - next milestone: the open milestone whose end is the earliest, today or
//     later.
// -----------------------------------------------------------------------------

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;

export const fold = (value) =>
  String(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

const idString = (value) =>
  (Number.isInteger(value) && value > 0) || /^[1-9]\d*$/.test(String(value ?? ''))
    ? String(value)
    : null;

/**
 * Every project the key sees, in the order Leantime gives them. Strategies
 * and programs (Leantime's project groups) hold no ticket of their own: left out.
 * @param {unknown[]} items of Projects.Projects.getAll
 * @returns {Array<{ id: string, name: string }>}
 */
export function parseProjects(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .filter((project) => idString(project?.id) !== null)
    .filter((project) => !['strategy', 'program'].includes(project.type))
    .filter((project) => !seen.has(String(project.id)) && seen.add(String(project.id)))
    .map((project) => ({
      id: String(project.id),
      name: text(project.name) || `#${project.id}`,
    }));
}

/**
 * The local calendar day of a Leantime date (`YYYY-MM-DD HH:MM:SS`, stored in
 * UTC). Two writers coexist: the API and the mobile app store a bare day as
 * midnight, without any conversion (that day, as is), while the web app
 * converts the user's local date and time to UTC (its local day in the time
 * zone of Gladys). `0000-00-00 00:00:00` and empty mean no date.
 * @returns {string|null} `YYYY-MM-DD`
 */
export function leantimeDay(raw, timeZone) {
  const match = typeof raw === 'string' ? raw.trim().match(DATE_TIME) : null;
  if (!match) {
    return null;
  }
  const [, y, m, d, hh = '00', mm = '00', ss = '00'] = match;
  const [year, month, day] = [Number(y), Number(m), Number(d)];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (year < 1971 || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  if (hh === '00' && mm === '00' && ss === '00') {
    return `${y}-${m}-${d}`;
  }
  return dayString(Date.UTC(year, month - 1, day, Number(hh), Number(mm), Number(ss)), timeZone);
}

/** A Leantime UTC date and time as an instant, else null. */
export function leantimeInstant(raw) {
  const match = typeof raw === 'string' ? raw.trim().match(DATE_TIME) : null;
  if (!match || match[1] === '0000') {
    return null;
  }
  const [, y, m, d, hh = '0', mm = '0', ss = '0'] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  return Number.isFinite(ms) ? ms : null;
}

// The statuses of the "Done" type in a project whose labels are unknown
// (Leantime's defaults: 0 "Done", -1 "Archived").
const DEFAULT_DONE = new Set(['0', '-1']);

/**
 * Whether a status of a project is of the "Done" type.
 * @param {Record<string, { statusType?: string }>|undefined} labels Tickets.getStatusLabels
 */
export function isDoneStatus(status, labels) {
  const key = String(status);
  const label = labels?.[key];
  if (label && typeof label.statusType === 'string') {
    return label.statusType.toUpperCase() === 'DONE';
  }
  return DEFAULT_DONE.has(key);
}

const fullName = (first, last) => [text(first), text(last)].filter(Boolean).join(' ');

/**
 * The tickets of an answer, with their due day and whether they are open.
 * @param {unknown[]} items of Tickets.Tickets.getAll
 * @param {{ timeZone: string, labels: Map<string, object> }} options labels by project id
 */
export function parseTickets(items, { timeZone, labels }) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .filter((item) => idString(item?.id) !== null && idString(item.projectId) !== null)
    .filter((item) => !seen.has(String(item.id)) && seen.add(String(item.id)))
    .map((item) => {
      const milestone = item.type === 'milestone';
      const projectId = String(item.projectId);
      const dueDay = milestone
        ? (leantimeDay(item.editTo, timeZone) ?? leantimeDay(item.dateToFinish, timeZone))
        : leantimeDay(item.dateToFinish, timeZone);
      const assigneeId = milestone ? null : idString(item.editorId);
      return {
        id: String(item.id),
        name: text(item.headline) || `#${item.id}`,
        projectId,
        projectName: text(item.projectName),
        type: text(item.type) || 'task',
        milestone,
        status: text(item.statusLabel),
        open: !isDoneStatus(item.status, labels?.get(projectId)),
        assigneeId,
        assignee: assigneeId ? fullName(item.editorFirstname, item.editorLastname) : '',
        dueDay,
        dueAt: dueDay ? dayStart(dueDay, timeZone) : null,
        modifiedAt: leantimeInstant(item.modified),
      };
    });
}

// --- Local days -------------------------------------------------------------------

const partsFormatters = new Map();

function zonedParts(ms, timeZone) {
  let format = partsFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    partsFormatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(
    format.formatToParts(new Date(ms)).map(({ type, value }) => [type, Number(value)]),
  );
  return parts;
}

/** Offset of `timeZone` from UTC at `ms`, in milliseconds. */
function offsetAt(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC instant of local midnight of a local calendar day (DST-safe). */
function localMidnight(year, month, day, timeZone) {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetAt(guess, timeZone);
  let start = guess - offsetAt(first, timeZone);
  // Where the clocks jump at midnight (Chile, Cuba), 00:00 does not exist and
  // the instant found is 23:00 the day before: the day starts an hour later.
  if (zonedParts(start, timeZone).day !== day) {
    start += 60 * 60_000;
  }
  return start;
}

/** UTC instant of a local wall-clock time (in a DST overlap, one of the two). */
export function localTime(year, month, day, hour, minute, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - offsetAt(wall, timeZone);
  return wall - offsetAt(first, timeZone);
}

/** A time zone Intl knows, else the one of the process. */
export function resolveTimeZone(timeZone) {
  try {
    if (timeZone) {
      new Intl.DateTimeFormat('en-US', { timeZone });
      return timeZone;
    }
  } catch {
    // fall through
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Start and end (exclusive) of the local day holding `now`. */
export function localDay(now, timeZone) {
  const p = zonedParts(now, timeZone);
  const start = localMidnight(p.year, p.month, p.day, timeZone);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const end = localMidnight(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timeZone,
  );
  return { start, end };
}

/** The local calendar day of `ms`, `YYYY-MM-DD`. */
export function dayString(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Local midnight starting a `YYYY-MM-DD` day. */
export function dayStart(day, timeZone) {
  const [, y, m, d] = day.match(DAY);
  return localMidnight(Number(y), Number(m), Number(d), timeZone);
}

/** `YYYY-MM-DD`, `days` after the local day of `ms`. */
export function addDays(ms, days, timeZone) {
  const [y, m, d] = dayString(ms, timeZone).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

// --- Counters ---------------------------------------------------------------------

// The overdue tasks kept in the agenda (the widget shows ten rows).
export const AGENDA_OVERDUE = 10;

/**
 * Counters of one day, for a scope: the whole instance, or one project.
 * @param {ReturnType<typeof parseTickets>} tickets every ticket of the scope (open and done today)
 * @param {{ start: number, end: number }} day
 * @param {{ assigneeId?: string|null }} [options] only the tasks of one user
 */
export function summarize(tickets, day, { assigneeId = null } = {}) {
  const order = (a, b) => a.dueAt - b.dueAt || Number(a.id) - Number(b.id);
  const tasks = tickets.filter(
    (item) => !item.milestone && (assigneeId === null || item.assigneeId === assigneeId),
  );
  const open = tasks.filter((item) => item.open);
  const dated = open.filter((item) => item.dueAt !== null).sort(order);
  const late = dated.filter((item) => item.dueAt < day.start);
  const today = dated.filter((item) => item.dueAt >= day.start && item.dueAt < day.end);
  const milestones = tickets
    .filter((item) => item.milestone && item.open && item.dueAt !== null && item.dueAt >= day.start)
    .sort(order);
  return {
    dayStart: day.start,
    open: open.length,
    overdue: late.length,
    dueToday: today.length,
    done: tasks.filter(
      (item) => !item.open && item.modifiedAt !== null && item.modifiedAt >= day.start,
    ).length,
    next: dated.find((item) => item.dueAt >= day.start) ?? null,
    nextMilestone: milestones[0] ?? null,
    // What is left by tonight: the most recent overdue ones (oldest first), then today's.
    agenda: [...late.slice(-AGENDA_OVERDUE), ...today],
  };
}

/**
 * Find an item by its id or its exact name (case, accents and repeated blanks ignored).
 * @template {{ id: string, name: string }} T
 * @param {T[]} items
 * @param {unknown} query
 * @returns {{ item: T|null, reason?: 'empty'|'not_found'|'ambiguous' }}
 */
export function findByIdOrName(items, query) {
  const wanted = String(query ?? '')
    .trim()
    .replace(/^#/, '');
  if (!wanted) {
    return { item: null, reason: 'empty' };
  }
  const byId = items.find((item) => item.id === wanted);
  if (byId) {
    return { item: byId };
  }
  const matches = items.filter((item) => fold(item.name) === fold(wanted));
  if (matches.length === 1) {
    return { item: matches[0] };
  }
  return { item: null, reason: matches.length > 1 ? 'ambiguous' : 'not_found' };
}
