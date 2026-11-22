// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `tasks_today`.
//
// The use case: the office or kitchen tablet shows the tasks due today and
// the overdue ones (10 at most), for the whole instance or one followed
// project (a device chosen in the widget settings), optionally only those of
// one assignee (their name, as in Leantime).
//
// Budget (8 components, 2 texts): two tiles (due today, overdue) and one
// status list (overdue first, then today's, with their project). Nothing
// left: a sentence and the next milestone. The figures are values, not bound
// to device features, so the widget works before any device is added. No
// button: closing a task depends on the statuses of each project.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { formatDay } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { pick } from './texts.js';

export const MAX_ROWS = 10;

export const TEXT = {
  configure: {
    en: 'Enter the address of your Leantime and an API key in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre Leantime et une clé d'API dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Leantime und einen API-Schlüssel in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su Leantime y una clave de API en la configuración de la integración.',
  },
  unknown: {
    en: 'This project is no longer followed: choose another device in the widget settings.',
    fr: "Ce projet n'est plus suivi : choisissez un autre appareil dans les réglages du widget.",
    de: 'Dieses Projekt wird nicht mehr verfolgt: Wähle ein anderes Gerät in den Widget-Einstellungen.',
    es: 'Este proyecto ya no se sigue: elija otro dispositivo en la configuración del widget.',
  },
  noAnswer: {
    en: 'Leantime does not answer: see the Configuration screen of the integration.',
    fr: "Leantime ne répond pas : voir l'écran Configuration de l'intégration.",
    de: 'Leantime antwortet nicht: Sieh dir die Konfiguration der Integration an.',
    es: 'Leantime no responde: consulte la pantalla de configuración de la integración.',
  },
  stale: {
    en: 'Leantime does not answer: last known tasks.',
    fr: 'Leantime ne répond pas : dernières tâches connues.',
    de: 'Leantime antwortet nicht: zuletzt bekannte Aufgaben.',
    es: 'Leantime no responde: últimas tareas conocidas.',
  },
  nothing: {
    en: 'No task due today.',
    fr: "Aucune tâche à échéance aujourd'hui.",
    de: 'Heute ist keine Aufgabe fällig.',
    es: 'Ninguna tarea vence hoy.',
  },
  dueToday: { en: 'Due today', fr: "Aujourd'hui", de: 'Heute fällig', es: 'Para hoy' },
  overdue: { en: 'Overdue', fr: 'En retard', de: 'Überfällig', es: 'Atrasadas' },
  today: { en: 'Today', fr: "Aujourd'hui", de: 'Heute', es: 'Hoy' },
  milestone: { en: 'Milestone', fr: 'Jalon', de: 'Meilenstein', es: 'Hito' },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** The status row of a task: its due day (or "today") and its project. */
function row(hub, item, { day, showProject, language }) {
  const late = item.dueAt < day.start;
  const when = late
    ? formatDay(item.dueAt, { language, timeZone: hub.timeZone })
    : t(TEXT.today, language);
  const where = showProject && item.projectId ? hub.shownProjectName(item.projectId) : '';
  return {
    label: fit(item.name, 40),
    icon: late ? 'alert-circle' : 'clock',
    value: fit(where ? `${when} · ${where}` : when, 40),
    color: late ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
  };
}

async function get(hub, { settings, language = 'en' }) {
  if (!hub.client) {
    return message(TEXT.configure, language);
  }
  if (hub.error && hub.readAt === 0) {
    return message(TEXT.noAnswer, language);
  }
  const { projectId, unknown } = hub.view(settings?.device || null);
  if (unknown) {
    return message(TEXT.unknown, language);
  }
  const assignee = typeof settings?.assignee === 'string' ? settings.assignee : '';
  const summary = hub.summary(projectId, { assignee });
  const day = { start: summary.dayStart };
  const components = [];
  if (hub.error) {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.stale, language) });
  }
  components.push(
    { type: 'value', value: summary.dueToday, label: t(TEXT.dueToday, language), icon: 'calendar' },
    {
      type: 'value',
      value: summary.overdue,
      label: t(TEXT.overdue, language),
      icon: 'alert-circle',
      color: summary.overdue > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
  );
  if (summary.agenda.length === 0) {
    components.push({ type: 'text', variant: 'body', text: t(TEXT.nothing, language) });
    if (summary.nextMilestone) {
      const when = formatDay(summary.nextMilestone.dueAt, { language, timeZone: hub.timeZone });
      components.push({
        type: 'status',
        items: [
          {
            label: fit(summary.nextMilestone.name, 40),
            icon: 'flag',
            value: fit(`${t(TEXT.milestone, language)} · ${when}`, 40),
            color: WIDGET_COLORS.NEUTRAL,
          },
        ],
      });
    }
    return { ttl_seconds: 300, components };
  }
  components.push({
    type: 'status',
    items: summary.agenda
      .slice(0, MAX_ROWS)
      .map((item) => row(hub, item, { day, showProject: projectId === null, language })),
  });
  return { ttl_seconds: 300, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get },
};
