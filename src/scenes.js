// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+). The fields
// are strings, so a scene variable fits too (`{{triggerEvent.data.task}}`).
//
//   - `create_task`: create a task in a project, with an optional due date
//     ("check the smoke detectors" every month, "call the plumber" from a
//     button);
//   - `read_today`: the tasks due today and the overdue ones as a sentence,
//     for a message or a voice announcement in the morning.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async create_task(hub, { fields = {} }) {
    return hub.createTask(fields);
  },

  async read_today(hub, { fields = {} }) {
    return hub.today(fields);
  },
};
