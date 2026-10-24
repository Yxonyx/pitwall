/** A bot is an agent or script that talks in the room. It says things; it never asks for work and never approves. */
export type Role = 'owner' | 'peer' | 'observer' | 'bot';

export type TaskState =
  | 'queued'
  | 'delivered'
  | 'accepted'
  | 'running'
  | 'needs_input'
  | 'needs_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'uncertain';

export type TaskMode = 'talk' | 'work';
export type SendMode = 'say' | 'work' | 'status';
export type SenderKind = 'human' | 'agent' | 'system';
export type Activity = 'idle' | 'working' | 'waiting';

export interface Person {
  id: string;
  name: string;
  role: Role;
  online: boolean;
}

export interface Machine {
  id: string;
  name: string;
  online: boolean;
  lastSeenAt: string | null;
}

export interface Agent {
  id: string;
  machineId: string;
  machineName: string;
  name: string;
  runtime: string;
  online: boolean;
  lastSeenAt: string | null;
}

export interface Message {
  id: string;
  clientId: string | null;
  senderKind: SenderKind;
  senderId: string;
  senderName: string;
  body: string;
  taskId: string | null;
  createdAt: string;
  origin: 'room' | 'github';
  externalId: string | null;
  link: string | null;
  hop: number;
}

export interface Task {
  id: string;
  clientId: string;
  requesterId: string;
  requesterName: string;
  agentId: string;
  agentName: string;
  machineId: string;
  machineName: string;
  mode: TaskMode;
  body: string;
  state: TaskState;
  approved: boolean;
  result: string | null;
  error: string | null;
  question: string | null;
  pendingInputId: string | null;
  pendingInput: string | null;
  hop: number;
  createdAt: string;
  updatedAt: string;
  approvalExpiresAt: string | null;
}

export interface TaskEvent {
  id: number;
  taskId: string;
  state: TaskState;
  note: string | null;
  createdAt: string;
}

export interface Assign {
  id: string;
  state: TaskState;
  mode: TaskMode;
  body: string;
  agentId: string;
  agentName: string;
  machineId: string;
  requesterName: string;
  approved: boolean;
  hop: number;
  pendingInputId: string | null;
  pendingInput: string | null;
}

export interface FanEvent {
  cursor: number;
  type: 'message' | 'task';
  message?: Message;
  task?: Task;
  taskEvent?: TaskEvent;
}

export interface Snapshot {
  me: Person;
  people: Person[];
  machines: Machine[];
  agents: Agent[];
  messages: Message[];
  tasks: Task[];
  taskEvents: TaskEvent[];
  cursor: number;
}

export interface RoomView {
  people: Person[];
  machines: Machine[];
  agents: Agent[];
  messages: Message[];
  tasks: Task[];
  taskEvents: TaskEvent[];
  cursor: number;
}

export const STATE_LABEL: Record<TaskState, string> = {
  queued: 'Queued',
  delivered: 'On the machine',
  accepted: 'Accepted',
  running: 'Working',
  needs_input: 'Question',
  needs_approval: 'Needs approval',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  uncertain: 'Uncertain',
};

export function taskBucket(state: TaskState): 'open' | 'waiting' | 'done' {
  if (state === 'needs_approval' || state === 'needs_input' || state === 'uncertain') return 'waiting';
  if (state === 'completed' || state === 'failed' || state === 'cancelled') return 'done';
  return 'open';
}

export function agentActivity(tasks: readonly Task[], agentId: string): Activity {
  const mine = tasks.filter((task) => task.agentId === agentId);
  if (mine.some((task) => task.state === 'running')) return 'working';
  if (mine.some((task) => task.state === 'needs_input' || task.state === 'needs_approval')) return 'waiting';
  return 'idle';
}
