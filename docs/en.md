# Leantime

The tasks of your self-hosted [Leantime](https://leantime.io) in Gladys: the
open ones, those due today, the overdue ones, those done today and the next
milestone, for the whole instance and for the projects you choose. A scene
reacts when a task is assigned to someone or becomes overdue, another one
creates "check the smoke detectors" every month, and Gladys can read today's
tasks every morning.

> **Feedback welcome.** This integration was tested against a real Leantime
> server (Docker image `leantime/leantime` 3.15.3 with MariaDB 11, November
> 2026), not yet in daily use. If something does not work as described, say
> so on the [Gladys forum](https://community.gladysassistant.com) or in the
> [issues](https://github.com/guim31/gladys-leantime/issues).

## What you need

- Gladys Assistant 5.1.0 or later.
- A **Leantime 3.x** Gladys can reach on your network.
- A Leantime **API key**: in Leantime, **Company Settings** → **API Keys**
  tab → **Generate API Key** (an administrator can do it). Give it the
  **Editor** role, so it can create tasks, and the projects to follow. Copy
  the key (`lt_…`): Leantime shows it only once.

The API key acts as a user of its own: the integration sees the projects
given to the key (an administrator key sees them all), and the tasks created
from Gladys bear its name.

## Set up

1. In Gladys, **Integrations** → install **Leantime**.
2. On the **Configuration** screen, fill in:
   - **Address**: the address of Leantime as in the browser, for example
     `http://192.168.1.20:8080`, or `https://pm.example.org` behind a reverse
     proxy (a prefix such as `/leantime` is kept);
   - **API key**.
3. Options:
   - **Followed projects**: names or numbers (the number is in the address of
     the project) separated by commas, 20 at most. Each gets its device,
     besides the one of the whole instance. Empty: the instance device only;
   - **Accept self-signed certificates**: for an `https://` address with a
     self-signed certificate, on your own server only;
   - **Refresh interval**: 1 to 10 minutes (5 by default). Midnight is always
     followed on time, whatever the interval;
   - **Language of the feature names**: the names given to the features when
     a device is added (French by default), and the texts sent to scenes.
4. Save, then **Test the connection**: it reads Leantime and reports the
   number of open tasks, of projects and of followed projects.
5. In the **Discovery** tab, add the devices you want.

## Devices

**Leantime**, for the whole instance (every project the key sees), and
**Leantime _project_** for each followed project, with these features:

| Feature          | What it shows                                                         |
| ---------------- | --------------------------------------------------------------------- |
| `Open tasks`     | the tasks whose status is not of the "Done" type                      |
| `Due today`      | the open tasks whose due date is today                                |
| `Overdue`        | the open tasks whose due date has passed                              |
| `Done today`     | the tasks of a "Done" status last changed today                       |
| `Next milestone` | the open milestone that ends the soonest, today included; `None` else |

A **task** is any ticket that is not a milestone (task, bug, story,
subtask). It is **open** as long as its status is not of the "Done" type in
its project (`Done` and `Archived` by default). Its due day is its **due
date**; a milestone's is its end date. "Today" is the day in the time zone of
Gladys. Leantime keeps no closing date: "Done today" counts the done tasks
changed today, so also one finished earlier and edited today.

## Dashboard

The **Today's tasks** widget shows two tiles (today, overdue) and the list of
the tasks to finish by tonight (10 at most), the overdue ones first with their
date, then today's, with their project. Choose a project device in the widget
settings to see only its tasks, and give a name in **Only the tasks of** to see
only one person's. When nothing is due, the widget says so and gives the next
milestone. Projects carry the name given in Gladys once their device is added.

The counters can also go on the dashboard like any device feature.

## Scenes

### Triggers

- **Leantime task assigned**: an open task is now assigned to someone: it was
  just assigned or reassigned, created with an assignee, or reopened.
- **Leantime task overdue**: at midnight, a task due that day is still open.
  Once per task and due date.

Filters: the project (a project device, not the instance one) and, for the
first one, the **assignee**: their first and last name exactly as Leantime
shows them (`Camille Martin`). Data passed to the actions: the task, its
number, its project, its type, its status, the assignee, its due date
(`YYYY-MM-DD`) and its address in Leantime.

A change is seen at the next reading: within the refresh interval. A due date
moved by hand to a day already over fires nothing. A restart fires nothing
twice; a task assigned while the integration was stopped fires at its
restart, as does a midnight less than an hour old.

### Actions

- **Create a Leantime task**: a title; the project by its name or number
  (empty: the first followed project); an optional **due date**: `2026-11-24`,
  or `+3d` for in three days; an optional description. The task is created
  unassigned, in the `New` status. Results: the task, its number, its
  address, its project, its due date.
- **Read today's Leantime tasks**: the tasks to finish by tonight as a
  sentence (`3 task(s) due by tonight: …. 1 overdue.`), for the whole
  instance or a project, and for everyone or one assignee. Results: the
  sentence, the number of tasks due by tonight, of overdue ones. Send the
  sentence in a message, or have Gladys say it.

A failure (unknown project, date not understood, key without the right) shows
in red with its reason. The fields accept scene variables, for example
`{{triggerEvent.data.task}}`.

### Scene ideas

- At 08:00, **Read today's Leantime tasks** for `Camille Martin`, then send the
  sentence on Telegram.
- **Leantime task assigned** to `Camille Martin`: send the task and its
  address in a message.
- **Leantime task overdue** in the `Home` project: turn the reminder lamp
  orange.
- On the first of the month, **Create a Leantime task** `Check the smoke
detectors` in `Home`, due `+7d`.

## Troubleshooting

- **"Leantime does not answer"**: check the address and port from the Gladys
  machine (the address opens Leantime in a browser).
- **"API key refused"**: the key was mistyped (it starts with `lt_`) or
  deleted: generate a new one.
- **"No Leantime API at this address"**: the address answers, but not with the
  Leantime API: check the port and the prefix. After an update of Leantime,
  open it once in a browser as an administrator: it may wait for its database
  update.
- **"The address redirects"**: enter the `https://` address.
- **"The API key may not do this"**: give it the Editor role, and the project.
- **"This Leantime is too old"**: version 3.x is needed.
- **A project is missing**: give it to the key in Leantime; a name typed in
  **Followed projects** that matches no project is ignored, and **Test the
  connection** reports it. Closed projects are left out.
- **"Several projects have this name"**: give its number.
- Logs: `LOG_LEVEL=debug` on the container shows each reading.

## Limits

- Leantime is read every 1 to 10 minutes (and at midnight): a change in
  Leantime shows in Gladys within that delay. Each reading makes three
  requests (projects, open tickets, tickets done today), plus one per project
  for its statuses once an hour. Leantime 3.7 and later filter the tickets on
  the server; an older 3.x answers every ticket, which the integration sorts
  itself.
- The integration creates tasks; it does not change, close, assign or delete
  them, and reads neither their comments, nor their files, nor the time spent.
  The assignee of a task created from Gladys is set in Leantime.
- The API key is kept by Gladys in the configuration of the integration and
  sent only to the configured address. Gladys keeps no Leantime data outside
  `/data/leantime-state.json` (the time of the last reading and the assignee
  number of each open task, so no event fires twice).
- Not affiliated with Leantime or its publisher. Leantime is a trademark of its
  owner.
