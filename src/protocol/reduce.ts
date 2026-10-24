import type { Agent, FanEvent, Machine, Person, RoomView, Snapshot } from './types.js';

export function emptyView(): RoomView {
  return {
    people: [],
    machines: [],
    agents: [],
    messages: [],
    tasks: [],
    taskEvents: [],
    cursor: 0,
  };
}

export function applySnapshot(snapshot: Snapshot): RoomView {
  return {
    people: snapshot.people,
    machines: snapshot.machines,
    agents: snapshot.agents,
    messages: snapshot.messages,
    tasks: snapshot.tasks,
    taskEvents: snapshot.taskEvents,
    cursor: snapshot.cursor,
  };
}

export function applyEvent(view: RoomView, event: FanEvent): RoomView {
  if (event.cursor <= view.cursor) return view;
  const messages = view.messages.slice();
  const tasks = view.tasks.slice();
  const taskEvents = view.taskEvents.slice();
  if (event.type === 'message' && event.message && !messages.some((item) => item.id === event.message?.id)) {
    messages.push(event.message);
  }
  if (event.type === 'task' && event.task) {
    const index = tasks.findIndex((item) => item.id === event.task?.id);
    if (index === -1) tasks.push(event.task);
    else tasks[index] = event.task;
    if (event.taskEvent && !taskEvents.some((item) => item.id === event.taskEvent?.id)) {
      taskEvents.push(event.taskEvent);
    }
  }
  return { ...view, messages, tasks, taskEvents, cursor: event.cursor };
}

export function applyPresence(
  view: RoomView,
  presence: { people: Person[]; machines: Machine[]; agents: Agent[] },
): RoomView {
  return { ...view, people: presence.people, machines: presence.machines, agents: presence.agents };
}
