// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene action
// errors and results. Four languages, the four of the Gladys interface;
// German says "du", Spanish "usted". test/i18n.test.js checks every table.
// Leantime's "task" is "tâche", "Aufgabe" and "tarea"; its "milestone",
// "jalon", "Meilenstein" and "hito" (its own translations).
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './leantime/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your Leantime in the configuration.',
    fr: "Saisissez l'adresse de votre Leantime dans la configuration.",
    de: 'Gib die Adresse deines Leantime in der Konfiguration ein.',
    es: 'Introduzca la dirección de su Leantime en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.20:8080',
    fr: 'Adresse incomprise, ex. http://192.168.1.20:8080',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.20:8080',
    es: 'Dirección no válida, p. ej. http://192.168.1.20:8080',
  },
  noApiKey: {
    en: 'Enter a Leantime API key in the configuration.',
    fr: "Saisissez une clé d'API de Leantime dans la configuration.",
    de: 'Gib in der Konfiguration einen Leantime-API-Schlüssel ein.',
    es: 'Introduzca una clave de API de Leantime en la configuración.',
  },
};

// One short explanation per error kind (src/leantime/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Leantime does not answer',
    fr: 'Leantime ne répond pas',
    de: 'Leantime antwortet nicht',
    es: 'Leantime no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API key refused (mistyped or deleted?)',
    fr: "clé d'API refusée (mal recopiée ou supprimée ?)",
    de: 'API-Schlüssel abgelehnt (falsch kopiert oder gelöscht?)',
    es: 'clave de API rechazada (¿mal copiada o eliminada?)',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'the API key may not do this (its role, or the project not given to it?)',
    fr: "la clé d'API n'a pas ce droit (son rôle, ou le projet ne lui est pas attribué ?)",
    de: 'der API-Schlüssel darf das nicht (seine Rolle, oder das Projekt ist ihm nicht zugewiesen?)',
    es: 'la clave de API no tiene este permiso (¿su rol, o el proyecto no le está asignado?)',
  },
  [ERROR_KINDS.UNSUPPORTED]: {
    en: 'this Leantime is too old (3.x needed)',
    fr: 'ce Leantime est trop ancien (3.x nécessaire)',
    de: 'dieses Leantime ist zu alt (3.x nötig)',
    es: 'este Leantime es demasiado antiguo (se necesita 3.x)',
  },
  [ERROR_KINDS.INVALID]: {
    en: 'values refused',
    fr: 'valeurs refusées',
    de: 'Werte abgelehnt',
    es: 'valores rechazados',
  },
  [ERROR_KINDS.NOT_LEANTIME]: {
    en: 'no Leantime API at this address (or its database awaits an update)',
    fr: 'aucune API de Leantime à cette adresse (ou sa base attend une mise à jour)',
    de: 'keine Leantime-API unter dieser Adresse (oder ihre Datenbank wartet auf ein Update)',
    es: 'no hay ninguna API de Leantime en esta dirección (o su base de datos espera una actualización)',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'too many requests, retrying later',
    fr: 'trop de requêtes, nouvel essai plus tard',
    de: 'zu viele Anfragen, neuer Versuch später',
    es: 'demasiadas solicitudes, se reintentará más tarde',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: (open, projects, followed) =>
      `Leantime OK: ${open} open task(s) in ${projects} project(s), ${followed} followed.`,
    failed: (reason) => `Leantime: ${reason.replace(/\.$/, '')}.`,
  },
  fr: {
    ok: (open, projects, followed) =>
      `Leantime OK : ${open} tâche(s) ouverte(s) dans ${projects} projet(s), ${followed} suivi(s).`,
    failed: (reason) => `Leantime : ${reason.replace(/\.$/, '')}.`,
  },
  de: {
    ok: (open, projects, followed) =>
      `Leantime OK: ${open} offene Aufgabe(n) in ${projects} Projekt(en), ${followed} verfolgt.`,
    failed: (reason) => `Leantime: ${reason.replace(/\.$/, '')}.`,
  },
  es: {
    ok: (open, projects, followed) =>
      `Leantime OK: ${open} tarea(s) abierta(s) en ${projects} proyecto(s), ${followed} seguido(s).`,
    failed: (reason) => `Leantime: ${reason.replace(/\.$/, '')}.`,
  },
};

// Logged and shown when a project typed in the configuration does not exist.
export const UNKNOWN_PROJECTS = {
  en: (names) => `Unknown project(s) ignored: ${names}.`,
  fr: (names) => `Projet(s) inconnu(s) ignoré(s) : ${names}.`,
  de: (names) => `Unbekannte(s) Projekt(e) ignoriert: ${names}.`,
  es: (names) => `Proyecto(s) desconocido(s) ignorado(s): ${names}.`,
};

// Errors of the scene actions (shown in Gladys, in red).
export const ACTION_TEXT = {
  notConfigured: {
    en: 'Leantime is not configured.',
    fr: "Leantime n'est pas configuré.",
    de: 'Leantime ist nicht konfiguriert.',
    es: 'Leantime no está configurado.',
  },
  emptyTitle: {
    en: 'Give the title of the new task.',
    fr: 'Indiquez le titre de la nouvelle tâche.',
    de: 'Gib den Titel der neuen Aufgabe an.',
    es: 'Indique el título de la nueva tarea.',
  },
  badDue: {
    en: 'Due date not understood: 2026-11-24 or +3d.',
    fr: 'Échéance incomprise : 2026-11-24 ou +3d.',
    de: 'Fälligkeit nicht verstanden: 2026-11-24 oder +3d.',
    es: 'Vencimiento no válido: 2026-11-24 o +3d.',
  },
  noProject: {
    en: 'Give the project, or follow one in the configuration.',
    fr: 'Indiquez le projet, ou suivez-en un dans la configuration.',
    de: 'Gib das Projekt an oder verfolge eines in der Konfiguration.',
    es: 'Indique el proyecto, o siga uno en la configuración.',
  },
  projectNotFound: {
    en: 'No project has this name or id in Leantime (for this API key).',
    fr: "Aucun projet ne porte ce nom ou ce numéro dans Leantime (pour cette clé d'API).",
    de: 'Kein Projekt in Leantime hat diesen Namen oder diese Nummer (für diesen API-Schlüssel).',
    es: 'Ningún proyecto tiene este nombre o número en Leantime (para esta clave de API).',
  },
  projectAmbiguous: {
    en: 'Several projects have this name: give its number instead (in its address).',
    fr: 'Plusieurs projets portent ce nom : indiquez plutôt son numéro (dans son adresse).',
    de: 'Mehrere Projekte haben diesen Namen: Gib stattdessen seine Nummer an (in seiner Adresse).',
    es: 'Varios proyectos tienen este nombre: indique su número (en su dirección).',
  },
};

// The sentence of the "Read today's tasks" scene action, for a
// message or a voice announcement.
const join = (names, and) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} ${and} ${names.at(-1)}`;

export const TODAY_TEXT = {
  en: {
    none: 'No task due today.',
    list: (count, names) => `${count} task(s) due by tonight: ${join(names, 'and')}.`,
    overdue: (count) => ` ${count} overdue.`,
  },
  fr: {
    none: "Aucune tâche à échéance aujourd'hui.",
    list: (count, names) => `${count} tâche(s) à finir ce soir : ${join(names, 'et')}.`,
    overdue: (count) => ` ${count} en retard.`,
  },
  de: {
    none: 'Heute ist keine Aufgabe fällig.',
    list: (count, names) => `${count} Aufgabe(n) bis heute Abend fällig: ${join(names, 'und')}.`,
    overdue: (count) => ` ${count} überfällig.`,
  },
  es: {
    none: 'Ninguna tarea vence hoy.',
    list: (count, names) => `${count} tarea(s) para esta noche: ${join(names, 'y')}.`,
    overdue: (count) => ` ${count} atrasada(s).`,
  },
};

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A multi-language object from a function of the language. */
export const allLanguages = (render) =>
  Object.fromEntries(Object.keys(INIT_FAILED).map((language) => [language, render(language)]));

/**
 * An action failure: Gladys shows in red what a handler throws, in green what
 * it returns. The message is the multi-language object.
 */
export class ActionFailure extends Error {
  constructor(text) {
    super(text.en);
    this.message = text;
  }
}
