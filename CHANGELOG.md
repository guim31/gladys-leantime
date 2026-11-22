# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- The tasks of a self-hosted Leantime 3.x in Gladys, through its JSON-RPC API
  and an API key: a device for the whole instance and one per followed
  project, with the open tasks, those due today, the overdue ones, those done
  today and the next milestone.
- Scene triggers: a task assigned to someone (filter by project and
  assignee), a task overdue at midnight.
- Scene actions: create a task (project, title, due date, description), read
  today's tasks as a sentence for a message or a voice announcement.
- The "Today's tasks" dashboard widget, for the instance or one project,
  optionally for one assignee.
- "Test the connection" action, texts and documentation in English, French,
  German and Spanish.
