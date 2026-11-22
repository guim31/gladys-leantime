# Leantime for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings the projects of a self-hosted [Leantime](https://leantime.io) 3.x
into Gladys: the open tasks, those due today, the overdue ones, those done
today and the next milestone, scene triggers when a task is assigned to
someone or becomes overdue, and tasks created from a scene.

> **Feedback welcome.** The integration was checked against a real Leantime
> server (Docker image `leantime/leantime` 3.15.3 with MariaDB 11, November
> 2026), but not yet in everyday use with a real Gladys. Please report what
> works and what does not in the
> [issues](https://github.com/guim31/gladys-leantime/issues).

## Features

- **One device for the whole instance**, and **one per followed project** (by
  name or number, 20 at most), with _open tasks_, _due today_, _overdue_,
  _done today_ and the _next milestone_ (text).
- **Dashboard widget** "Today's tasks": two tiles and the tasks due by tonight
  (10 at most, overdue first), for the instance or a project, optionally for
  one assignee.
- **Scene triggers**: _Leantime task assigned_ (filters: project, assignee)
  and _Leantime task overdue_ (at midnight), with the task, its project, type,
  status, assignee, due date and address as variables. Once each, across
  restarts.
- **Scene actions**: _Create a Leantime task_ (project, title, optional due
  date such as `2026-11-24` or `+3d`, optional description) and _Read today's
  Leantime tasks_ (a sentence for a message or a voice announcement). A
  failure shows in red with its reason.
- On time: besides the refresh interval (1 to 10 minutes, 5 by default), the
  integration reads Leantime at local midnight (the time zone of Gladys).
- A **Test the connection** button, a connection status that names the
  problem (key refused, no Leantime API at this address, key without the
  right…), and a transport badge per device.
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- A self-hosted **Leantime 3.x** reachable from Gladys, and one of its **API
  keys** (Company Settings → API Keys), with the Editor role and the projects
  to follow. The integration sees the projects given to the key, and the tasks
  it creates bear the key's name.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-leantime`
   (or install **Leantime** from the catalog once it is listed).
2. In **Configuration**, enter the address of Leantime
   (`http://192.168.1.20:8080`, `https://pm.example.org`…) and the API key,
   and optionally the projects to follow. Save, then click **Test the
   connection**.
3. Open the **Discover** tab and add the devices.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

The integration uses the JSON-RPC 2.0 API of Leantime (`POST /api/jsonrpc`),
with the API key in the `x-api-key` header:

| Method                                                        | Use                                     |
| ------------------------------------------------------------- | --------------------------------------- |
| `leantime.rpc.Projects.Projects.getAll`                       | the projects, to follow some by name    |
| `leantime.rpc.Tickets.Tickets.getAll` (`statusType` NOT_DONE) | the open tickets: counters, events      |
| `leantime.rpc.Tickets.Tickets.getAll` (DONE, modified today)  | the tasks done today                    |
| `leantime.rpc.Tickets.Tickets.getStatusLabels` (once an hour) | which statuses of a project mean "done" |
| `leantime.rpc.Tickets.Tickets.addTicket`                      | create a task                           |

Leantime is read on a timer of the container; the devices are published with
`should_poll: false`. States are published only when they change, and every 12
hours otherwise. The "overdue" event is the end of a due day crossed since the
previous reading; an assignment is an open task whose assignee differs from
the previous reading. The time of the last reading and the assignee of each
open task are kept in `/data/leantime-state.json`.

Leantime stores dates in two ways: a bare day written through the API is kept
as midnight, as is, while the web app converts the user's local date and time
to UTC. A midnight date is read as that day; any other time is converted to
the time zone of Gladys.

## Checked on a real Leantime, and what was not

Checked against `leantime/leantime` 3.15.3 with `mariadb:11` in a Docker
network, on 22 November 2026, installed and given API keys by script: two
projects, a second user, tasks overdue, due today, later (one typed with a time,
as the web app does), undated, done today, archived, two milestones; an
administrator key and an Editor key limited to one project. The real answers
are in `test/fixtures/leantime/` and drive the tests, and a test checks that
the in-memory Leantime of the tests answers the captured calls exactly like
the server. The integration code then ran against that server with the SDK's
fake Gladys: counters, the widget, the sentence, creation of a task with
accents and a due date, the errors (wrong key, an Editor key on a project not
given to it, unknown project, wrong date, unreachable host, an address that is
not Leantime).

Not checked: a real Gladys instance, Leantime's cloud, Leantime versions
before 3.15 (older 3.x ignore the server filters: the code then sorts the
tickets itself, as a test simulates), a Leantime behind a reverse proxy with a
path prefix.

## Limitations

- Creates tasks; does not change, close, assign or delete them, nor read their
  comments, files or time entries.
- A change made in Leantime shows up within the refresh interval.
- Leantime keeps no closing date: "done today" counts the done tasks last
  changed today.
- The "assigned" trigger filters on the assignee's name exactly as Leantime
  shows it (Gladys compares scene filters by equality).

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory Leantime (`test/helpers/fakeLeantime.js`) built from real
answers. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [Leantime](https://github.com/Leantime/leantime) and its contributors
  (AGPL-3.0): the integration only talks to its API; no code was copied. The
  cover uses the official Leantime logo from its repository, to name the
  service.
- The architecture, the scene triggers and actions, the widget and the
  conformity tests follow
  [gladys-openproject](https://github.com/guim31/gladys-openproject), itself
  built on [gladys-wekan](https://github.com/guim31/gladys-wekan) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Leantime or its
publisher. Leantime and its logo are trademarks of their owner.

## License

Apache-2.0
