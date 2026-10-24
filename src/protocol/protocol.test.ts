import { describe, expect, it } from 'vitest';
import { canApprove, canCancel, canPost, workNeedsApproval } from './acl.js';
import { parseAddress } from './address.js';
import { applyEvent, applySnapshot, emptyView } from './reduce.js';
import { cleanSlug, safeHttps, statusBoard, withinHop } from './text.js';
import { assertTransition, stepsTo } from './transition.js';
import type { Snapshot, TaskState } from './types.js';

const STATES: TaskState[] = [
  'queued',
  'delivered',
  'accepted',
  'running',
  'needs_input',
  'needs_approval',
  'completed',
  'failed',
  'cancelled',
  'uncertain',
];

const ALLOWED_EDGES: Array<[TaskState, TaskState]> = [
  ['queued', 'delivered'],
  ['queued', 'cancelled'],
  ['queued', 'failed'],
  ['queued', 'uncertain'],
  ['needs_approval', 'queued'],
  ['needs_approval', 'cancelled'],
  ['needs_approval', 'failed'],
  ['delivered', 'accepted'],
  ['delivered', 'failed'],
  ['delivered', 'cancelled'],
  ['delivered', 'uncertain'],
  ['accepted', 'running'],
  ['accepted', 'failed'],
  ['accepted', 'cancelled'],
  ['accepted', 'uncertain'],
  ['running', 'needs_input'],
  ['running', 'completed'],
  ['running', 'failed'],
  ['running', 'cancelled'],
  ['running', 'uncertain'],
  ['needs_input', 'queued'],
  ['needs_input', 'cancelled'],
  ['needs_input', 'failed'],
  ['uncertain', 'failed'],
  ['uncertain', 'cancelled'],
];

describe('task transitions', () => {
  it('allows only the edges the room can explain', () => {
    for (const from of STATES) {
      for (const to of STATES) {
        const allowed = from === to || ALLOWED_EDGES.some((edge) => edge[0] === from && edge[1] === to);
        const detail = {
          result: 'done',
          error: 'failed',
          question: 'which file?',
        };
        if (allowed) {
          expect(() => assertTransition(from, to, detail)).not.toThrow();
        } else {
          expect(() => assertTransition(from, to, detail)).toThrow(/cannot move/);
        }
      }
    }
  });

  it('refuses a done state with no result', () => {
    expect(() => assertTransition('running', 'completed', {})).toThrow(/result/);
  });

  it('walks a queued task to done without skipping the machine', () => {
    expect(stepsTo('queued', 'completed')).toEqual(['delivered', 'accepted', 'running', 'completed']);
    expect(stepsTo('running', 'completed')).toEqual(['completed']);
    expect(stepsTo('queued', 'uncertain')).toEqual(['uncertain']);
    expect(stepsTo('needs_input', 'queued')).toEqual(['queued']);
    expect(stepsTo('running', 'running')).toEqual([]);
  });
});

describe('addressing', () => {
  const agents = [
    { id: 'a1', name: 'backend', machineName: 'mac' },
    { id: 'a2', name: 'backend', machineName: 'studio' },
    { id: 'a3', name: 'ios', machineName: 'studio' },
  ];

  it('parses an agent, a machine path, everyone, and ambiguity', () => {
    expect(parseAddress('hello', agents)).toEqual({ kind: 'none' });
    expect(parseAddress('@all what is going on?', agents)).toEqual({ kind: 'all' });
    expect(parseAddress('please @ios look', agents)).toEqual({ kind: 'agent', agentId: 'a3' });
    expect(parseAddress('@mac/backend fix it', agents)).toEqual({ kind: 'agent', agentId: 'a1' });
    expect(parseAddress('@backend status', agents)).toEqual({ kind: 'ambiguous', name: 'backend' });
    expect(parseAddress('@missing now', agents)).toEqual({ kind: 'unknown', token: 'missing' });
  });
});

describe('permissions', () => {
  it('lets a peer ask and makes work wait for an owner', () => {
    expect(canPost('peer')).toBe(true);
    expect(canPost('observer')).toBe(false);
    expect(workNeedsApproval('peer')).toBe(true);
    expect(workNeedsApproval('owner')).toBe(false);
    expect(canApprove('peer')).toBe(false);
    expect(canApprove('owner')).toBe(true);
    expect(canCancel('peer', true)).toBe(true);
    expect(canCancel('peer', false)).toBe(false);
    expect(canCancel('observer', true)).toBe(false);
  });
});

describe('status and links', () => {
  it('builds a board without creating work', () => {
    const text = statusBoard(
      [
        { name: 'ios', machineName: 'studio', online: false, activity: 'idle' },
        { name: 'backend', machineName: 'mac', online: true, activity: 'working' },
      ],
      'ship the header',
    );
    expect(text).toBe(
      ['Status: ship the header', 'backend · mac · working · online', 'ios · studio · idle · offline'].join('\n'),
    );
  });

  it('accepts https links and rejects other schemes', () => {
    expect(safeHttps('https://github.com/Yxonyx/raj/pull/1.')).toBe('https://github.com/Yxonyx/raj/pull/1');
    expect(safeHttps('http://example.com')).toBeNull();
    expect(safeHttps('javascript:alert(1)')).toBeNull();
  });

  it('stops a hop chain at three', () => {
    expect(withinHop(0)).toBe(true);
    expect(withinHop(2)).toBe(true);
    expect(withinHop(3)).toBe(false);
  });

  it('rejects a machine name that could be read as everyone', () => {
    expect(() => cleanSlug('all', 'Machine')).toThrow(/lowercase/);
    expect(cleanSlug('mac-studio', 'Machine')).toBe('mac-studio');
  });
});

describe('room reduce', () => {
  it('ignores an older event and keeps one copy of a message', () => {
    const snapshot: Snapshot = {
      me: { id: 'u1', name: 'Jonatan', role: 'owner', online: true },
      people: [],
      machines: [],
      agents: [],
      messages: [],
      tasks: [],
      taskEvents: [],
      cursor: 2,
    };
    let view = applySnapshot(snapshot);
    const message = {
      id: 'm1',
      clientId: 'client-1',
      senderKind: 'human' as const,
      senderId: 'u1',
      senderName: 'Jonatan',
      body: 'Hello',
      taskId: null,
      createdAt: '2026-10-24T00:00:00.000Z',
      origin: 'room' as const,
      externalId: null,
      link: null,
      hop: 0,
    };
    view = applyEvent(view, { cursor: 2, type: 'message', message });
    expect(view.messages).toHaveLength(0);
    view = applyEvent(view, { cursor: 3, type: 'message', message });
    view = applyEvent(view, { cursor: 4, type: 'message', message });
    expect(view.messages).toHaveLength(1);
    expect(emptyView().cursor).toBe(0);
  });
});
