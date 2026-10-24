import {
  agentActivity,
  applyEvent,
  applyPresence,
  applySnapshot,
  safeHttps,
  STATE_LABEL,
  taskBucket,
  type FanEvent,
  type Person,
  type RoomView,
  type SendMode,
  type Snapshot,
  type Task,
} from '../../src/protocol/index.js';
import './style.css';

const TOKEN_KEY = 'pitwall.token';

const app = document.querySelector('#app');
if (!(app instanceof HTMLElement)) throw new Error('Pitwall has nowhere to render.');

const token = localStorage.getItem(TOKEN_KEY);
if (!token) mountJoin(app);
else void boot(app, token);

if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js');

function mountJoin(root: HTMLElement): void {
  const main = el('main', 'join');
  const mark = brand();
  const title = el('h1', undefined, 'Join the room');
  const lead = el('p', undefined, 'Use the invite from the person who started Pitwall.');
  const form = el('form');
  form.id = 'join-form';
  const name = field('Name', 'join-name');
  name.input.setAttribute('autocomplete', 'nickname');
  name.input.maxLength = 40;
  name.input.required = true;
  const invite = field('Invite', 'join-code');
  invite.input.required = true;
  invite.input.autocapitalize = 'off';
  invite.input.spellcheck = false;
  const submit = el('button', 'primary', 'Join');
  submit.id = 'join-submit';
  submit.type = 'submit';
  const error = el('p', 'error');
  error.id = 'join-error';
  form.append(name.label, invite.label, submit, error);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    void fetch('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invite: invite.input.value.trim(), kind: 'person', name: name.input.value.trim() }),
    })
      .then(async (response) => {
        const body = (await response.json()) as { token?: string; error?: string };
        if (!response.ok || !body.token) throw new Error(body.error || 'That invite did not work.');
        localStorage.setItem(TOKEN_KEY, body.token);
        location.replace('/');
      })
      .catch((cause: unknown) => {
        error.textContent = cause instanceof Error ? cause.message : 'That invite did not work.';
        submit.disabled = false;
      });
  });
  main.append(mark, title, lead, form);
  root.replaceChildren(main);
}

async function boot(root: HTMLElement, session: string): Promise<void> {
  let snapshot: Snapshot;
  try {
    snapshot = await loadSnapshot(session);
  } catch (error) {
    if (error instanceof Error && error.message === 'unauthorized') {
      localStorage.removeItem(TOKEN_KEY);
      mountJoin(root);
      return;
    }
    root.replaceChildren(el('main', 'join', error instanceof Error ? error.message : 'The room is not reachable.'));
    return;
  }
  mountRoom(root, session, snapshot);
}

function mountRoom(root: HTMLElement, session: string, snapshot: Snapshot): void {
  let me = snapshot.me;
  let view = applySnapshot(snapshot);
  let mode: SendMode = 'say';
  let bucket: 'open' | 'waiting' | 'done' = 'open';
  let tab: 'room' | 'tasks' | 'people' = 'room';
  let selected = new URLSearchParams(location.search).get('task');
  let answerFor = '';
  let link = 'Connecting';
  let socket: WebSocket | null = null;
  let generation = 0;

  const shell = el('div', 'shell');
  shell.id = 'shell';
  const top = el('header', 'top');
  const mark = brand();
  const who = el('div', 'who');
  who.id = 'who';
  top.append(mark, who);

  const columns = el('div', 'columns');
  const room = el('section', 'pane');
  room.id = 'pane-room';
  const feed = el('div', 'scroll');
  feed.id = 'feed';
  const composer = el('form', 'composer');
  composer.id = 'composer';
  const modes = el('div', 'modes');
  const say = modeButton('mode-say', 'Say');
  const work = modeButton('mode-work', 'Work');
  const status = modeButton('mode-status', 'Status');
  modes.append(say, work, status);
  const agent = el('select');
  agent.id = 'agent';
  const hint = el('p', 'hint');
  hint.id = 'agent-hint';
  const body = el('textarea');
  body.id = 'composer-body';
  body.placeholder = 'Message or @agent';
  body.rows = 1;
  body.addEventListener('input', () => {
    body.style.height = 'auto';
    body.style.height = `${Math.min(body.scrollHeight, 140)}px`;
  });
  body.enterKeyHint = 'send';
  const send = el('button', 'primary', '\u2191');
  send.id = 'send';
  send.type = 'submit';
  send.setAttribute('aria-label', 'Send');
  const formError = el('p', 'error');
  formError.id = 'form-error';
  composer.append(modes, agent, hint, body, send, formError);

  const tasks = el('section', 'pane');
  tasks.id = 'pane-tasks';
  const filters = el('div', 'filters');
  const openFilter = filterButton('open', 'Open');
  const waitingFilter = filterButton('waiting', 'Waiting');
  const doneFilter = filterButton('done', 'Done');
  filters.append(openFilter, waitingFilter, doneFilter);
  const taskList = el('div', 'scroll');
  taskList.id = 'task-list';
  const thread = el('div');
  thread.id = 'thread';
  thread.hidden = true;
  const back = el('button', undefined, 'Back');
  back.id = 'thread-back';
  back.type = 'button';
  const threadTitle = el('h2');
  threadTitle.id = 'thread-title';
  const threadState = el('p', 'state');
  threadState.id = 'thread-state';
  const threadMessages = el('div');
  threadMessages.id = 'thread-messages';
  const activity = el('details', 'activity');
  activity.id = 'thread-activity';
  const summary = el('summary', undefined, 'Activity');
  const activityList = el('ol');
  activityList.id = 'activity';
  activity.append(summary, activityList);
  const actions = el('div', 'row');
  actions.id = 'thread-actions';
  const answerForm = el('form');
  answerForm.id = 'answer-form';
  const answerBody = el('textarea');
  answerBody.id = 'answer-body';
  answerBody.placeholder = 'Answer the question';
  const answerSend = el('button', 'primary', 'Answer');
  answerSend.type = 'submit';
  answerForm.append(answerBody, answerSend);
  answerForm.hidden = true;
  thread.append(back, threadTitle, threadState, threadMessages, activity, actions, answerForm);

  const people = el('section', 'pane');
  people.id = 'pane-people';
  const peopleList = el('div', 'scroll');
  peopleList.id = 'people-list';
  const inviteBox = el('div', 'invite-box');
  inviteBox.id = 'invite-box';
  const note = el(
    'p',
    'note',
    'Notifications on iPhone need Pitwall on the Home Screen and an HTTPS address. The room still works in the browser over HTTP while it is open.',
  );
  const pushButton = el('button', undefined, 'Enable notifications');
  pushButton.id = 'enable-push';
  pushButton.type = 'button';
  pushButton.hidden = true;

  room.append(el('h2', 'pane-title', 'Room'), feed, composer);
  tasks.append(el('h2', 'pane-title', 'Tasks'), filters, taskList, thread);
  const invites = el('details', 'invite');
  invites.append(el('summary', undefined, 'Invite someone or add a machine'), inviteBox);
  people.append(el('h2', 'pane-title', 'People'), peopleList, invites, note, pushButton);
  columns.append(room, tasks, people);

  const nav = el('nav', 'tabs');
  const navRoom = navButton('nav-room', 'Room');
  const navTasks = navButton('nav-tasks', 'Tasks');
  const navPeople = navButton('nav-people', 'People');
  nav.append(navRoom, navTasks, navPeople);
  shell.append(top, columns, nav);
  root.replaceChildren(shell);

  const setMode = (next: SendMode) => {
    mode = next;
    say.setAttribute('aria-pressed', next === 'say' ? 'true' : 'false');
    work.setAttribute('aria-pressed', next === 'work' ? 'true' : 'false');
    status.setAttribute('aria-pressed', next === 'status' ? 'true' : 'false');
    paintHint();
  };
  say.addEventListener('click', () => setMode('say'));
  work.addEventListener('click', () => setMode('work'));
  status.addEventListener('click', () => setMode('status'));
  setMode('say');

  const setBucket = (next: 'open' | 'waiting' | 'done') => {
    bucket = next;
    openFilter.classList.toggle('on', next === 'open');
    waitingFilter.classList.toggle('on', next === 'waiting');
    doneFilter.classList.toggle('on', next === 'done');
    paintTasks();
  };
  openFilter.addEventListener('click', () => setBucket('open'));
  waitingFilter.addEventListener('click', () => setBucket('waiting'));
  doneFilter.addEventListener('click', () => setBucket('done'));
  setBucket('open');

  const setTab = (next: 'room' | 'tasks' | 'people') => {
    tab = next;
    room.classList.toggle('active', next === 'room');
    tasks.classList.toggle('active', next === 'tasks');
    people.classList.toggle('active', next === 'people');
    navRoom.setAttribute('aria-pressed', next === 'room' ? 'true' : 'false');
    navTasks.setAttribute('aria-pressed', next === 'tasks' ? 'true' : 'false');
    navPeople.setAttribute('aria-pressed', next === 'people' ? 'true' : 'false');
  };
  navRoom.addEventListener('click', () => setTab('room'));
  navTasks.addEventListener('click', () => setTab('tasks'));
  navPeople.addEventListener('click', () => setTab('people'));
  setTab('room');

  agent.addEventListener('change', paintHint);
  back.addEventListener('click', () => {
    selected = null;
    paintThread();
    setTab('tasks');
  });

  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    formError.textContent = '';
    const text = body.value.trim();
    if (!text && mode !== 'status') {
      formError.textContent = 'Write a message first.';
      return;
    }
    if (mode === 'work' && !agent.value) {
      formError.textContent = 'Choose an agent for this work.';
      return;
    }
    const clientId = newClientId();
    const payload = { type: 'send', clientId, body: text || 'Status', mode, agentId: agent.value || null };
    if (!sendRaw(payload)) return;
    body.value = '';
    body.style.height = '';
    window.setTimeout(() => {
      if (!view.messages.some((message) => message.clientId === clientId)) void refresh();
    }, 2000);
  });

  answerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!selected) return;
    const text = answerBody.value.trim();
    if (!text) return;
    if (sendRaw({ type: 'answer', taskId: selected, clientId: newClientId(), body: text })) answerBody.value = '';
  });

  pushButton.addEventListener('click', () => {
    void enablePush(session).catch((error: unknown) => {
      formError.textContent = error instanceof Error ? error.message : 'Notifications were not enabled.';
    });
  });

  if (me.role === 'owner') mountInvites(inviteBox, session, formError);
  void fetch('/api/push/key')
    .then((response) => response.json() as Promise<{ publicKey?: string | null }>)
    .then((body) => {
      pushButton.hidden = !body.publicKey;
    })
    .catch(() => undefined);

  if (selected) setTab('tasks');
  paint();
  connect();

  function paint(): void {
    paintWho();
    paintAgents();
    paintFeed();
    paintTasks();
    paintPeople();
    paintThread();
  }

  function paintWho(): void {
    who.textContent = `${me.name} · ${me.role} · ${link}`;
  }

  function paintHint(): void {
    const chosen = view.agents.find((item) => item.id === agent.value);
    if (mode === 'work' && !chosen) hint.textContent = 'Work needs an agent. A peer waits for an owner.';
    else if (chosen && !chosen.online) hint.textContent = 'This agent is offline. The task waits on the machine.';
    else if (mode === 'status') hint.textContent = 'Status posts the board. It does not wake agents.';
    else hint.textContent = '';
  }

  function paintAgents(): void {
    const current = agent.value;
    agent.replaceChildren(el('option', undefined, 'No agent'));
    const first = agent.options[0];
    if (first) first.value = '';
    for (const item of view.agents) {
      const option = el('option', undefined, `${item.name} · ${item.machineName}${item.online ? '' : ' · offline'}`);
      option.value = item.id;
      agent.append(option);
    }
    if ([...agent.options].some((option) => option.value === current)) agent.value = current;
    paintHint();
  }

  function paintFeed(): void {
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
    feed.replaceChildren();
    if (view.messages.length === 0) {
      feed.append(el('p', 'empty', 'No messages yet. Say something, or address an agent with @name.'));
      return;
    }
    let before: RoomView['messages'][number] | undefined;
    for (const message of view.messages) {
      if (!before || day(before.createdAt) !== day(message.createdAt)) feed.append(el('div', 'day', dayLabel(message.createdAt)));
      feed.append(messageNode(message, before));
      before = message;
    }
    if (nearBottom) feed.scrollTop = feed.scrollHeight;
  }

  function messageNode(message: RoomView['messages'][number], before?: RoomView['messages'][number]): HTMLElement {
    const task = message.taskId ? view.tasks.find((item) => item.id === message.taskId) : undefined;
    const system = message.senderKind === 'system';
    const mine = message.senderKind === 'human' && message.senderId === me.id;
    const mirror = message.origin === 'github';
    const sameSender = Boolean(before) && before?.senderId === message.senderId && before?.senderKind === message.senderKind &&
      day(before.createdAt) === day(message.createdAt) &&
      Date.parse(message.createdAt) - Date.parse(before?.createdAt ?? '') < 5 * 60_000;
    const row = el('article', `message ${message.senderKind}${mine ? ' mine' : ''}${mirror ? ' mirror' : ''}${sameSender ? ' same' : ''}`);
    if (system) {
      row.append(el('div', 'note-line', message.body));
      return row;
    }
    if (!mine) {
      const agent = message.senderKind === 'agent';
      const avatar = el('div', `avatar ${message.senderKind}${sameSender ? ' ghost' : ''}`, agent || sameSender ? '' : initials(message.senderName));
      avatar.style.setProperty('--hue', String(hue(message.senderName)));
      row.append(avatar);
    }
    const bubble = el('div', 'bubble');
    if (!mine && !sameSender) {
      const who = el('div', 'name', message.senderName);
      who.style.setProperty('--hue', String(hue(message.senderName)));
      if (message.senderKind === 'agent') who.append(el('span', 'tag agent', 'agent'));
      if (mirror) who.append(el('span', 'tag', 'GitHub'));
      bubble.append(who);
    }
    const text = el('div', 'body');
    linkify(text, message.body);
    bubble.append(text);
    if (message.link) {
      const href = safeHttps(message.link);
      if (href) {
        const anchor = el('a', 'link', 'Open on GitHub');
        anchor.href = href;
        anchor.target = '_blank';
        anchor.rel = 'noreferrer noopener';
        bubble.append(anchor);
      }
    }
    if (task) {
      const chip = el('button', 'task-chip');
      chip.type = 'button';
      const state = el('span', 'state', STATE_LABEL[task.state]);
      state.dataset.state = task.state;
      chip.append(state, el('span', undefined, 'Open task'));
      chip.addEventListener('click', () => choose(task.id));
      bubble.append(chip);
    }
    bubble.append(el('div', 'time', clock(message.createdAt)));
    row.append(bubble);
    return row;
  }

  function paintTasks(): void {
    const rows = view.tasks.filter((task) => taskBucket(task.state) === bucket);
    taskList.replaceChildren();
    if (rows.length === 0) {
      taskList.append(el('p', 'empty', 'No tasks in this filter.'));
      return;
    }
    for (const task of rows) {
      const card = el('button', 'task-card');
      card.type = 'button';
      const state = el('div', 'state', STATE_LABEL[task.state]);
      state.dataset.state = task.state;
      card.append(el('div', 'meta', `${task.agentName} · ${task.machineName} · ${task.mode}`), state, el('div', 'body', task.body));
      card.addEventListener('click', () => choose(task.id));
      taskList.append(card);
    }
  }

  function paintPeople(): void {
    peopleList.replaceChildren();
    const humans = view.people.filter((person) => person.role !== 'bot');
    const bots = view.people.filter((person) => person.role === 'bot');
    peopleList.append(el('h3', 'group', 'People'));
    if (humans.length === 0) peopleList.append(el('p', 'empty', 'No one else is here yet.'));
    for (const person of humans) peopleList.append(contact(person.name, person.role, person.online, false));
    peopleList.append(el('h3', 'group', 'Agents'));
    if (bots.length === 0 && view.agents.length === 0) {
      peopleList.append(el('p', 'empty', 'No agents yet. Invite a bot, or add a machine.'));
    }
    for (const bot of bots) peopleList.append(contact(bot.name, 'bot, talks in the room', bot.online, true));
    for (const item of view.agents) {
      const line = `agent on ${item.machineName} \u00b7 ${agentActivity(view.tasks, item.id)}`;
      peopleList.append(contact(item.name, line, item.online, true));
    }
  }

  /** One row of the contact list: an avatar, a name, a line under it and a dot for who is here. */
  function contact(name: string, line: string, online: boolean, agent: boolean): HTMLElement {
    const row = el('article', `person${agent ? ' is-agent' : ''}`);
    const avatar = el('div', `avatar ${agent ? 'agent' : 'human'}`, agent ? '' : initials(name));
    avatar.style.setProperty('--hue', String(hue(name)));
    const text = el('div', 'who-text');
    const title = el('div', 'body', name);
    if (agent) title.append(el('span', 'tag agent', 'agent'));
    text.append(title, el('div', 'meta', line));
    const dot = el('span', `dot${online ? ' on' : ''}`);
    dot.title = online ? 'online' : 'offline';
    row.append(avatar, text, dot);
    return row;
  }

  function paintThread(): void {
    const task = view.tasks.find((item) => item.id === selected) ?? null;
    tasks.classList.toggle('thread-open', Boolean(task) && tab === 'tasks');
    thread.hidden = !task;
    if (!task) return;
    if (answerFor !== task.id) {
      answerFor = task.id;
      answerBody.value = '';
    }
    threadTitle.textContent = task.body;
    threadState.textContent = `${STATE_LABEL[task.state]} · ${task.agentName} on ${task.machineName}`;
    threadMessages.replaceChildren();
    let previous: RoomView['messages'][number] | undefined;
    for (const message of view.messages.filter((item) => item.taskId === task.id)) {
      threadMessages.append(messageNode(message, previous));
      previous = message;
    }
    activityList.replaceChildren();
    for (const event of view.taskEvents.filter((item) => item.taskId === task.id)) {
      activityList.append(el('li', undefined, `${when(event.createdAt)} · ${STATE_LABEL[event.state]}${event.note ? ` · ${event.note}` : ''}`));
    }
    actions.replaceChildren();
    if (me.role === 'owner' && task.state === 'needs_approval') {
      actions.append(action('approve', 'Approve', task), action('reject', 'Reject', task));
    }
    if (canCancel(me, task) && !['completed', 'failed', 'cancelled'].includes(task.state)) {
      actions.append(action('cancel', 'Cancel', task));
    }
    const canAnswer = task.state === 'needs_input' && me.role !== 'observer';
    answerForm.hidden = !canAnswer;
  }

  function choose(id: string): void {
    selected = id;
    setTab('tasks');
    paintThread();
  }

  function action(type: 'approve' | 'reject' | 'cancel', label: string, task: Task): HTMLButtonElement {
    const button = el('button', type === 'approve' ? 'primary' : undefined, label);
    button.type = 'button';
    button.id = type;
    button.addEventListener('click', () => sendRaw({ type, taskId: task.id }));
    return button;
  }

  function sendRaw(payload: Record<string, unknown>): boolean {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      formError.textContent = 'Reconnecting. The message was not sent.';
      return false;
    }
    socket.send(JSON.stringify(payload));
    return true;
  }

  function connect(): void {
    const mine = ++generation;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/api/ws`);
    socket = ws;
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'auth', token: session, since: view.cursor })));
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        type?: string;
        event?: FanEvent;
        people?: RoomView['people'];
        machines?: RoomView['machines'];
        agents?: RoomView['agents'];
        error?: string;
      };
      if (message.type === 'authed') {
        link = 'In the room';
        paintWho();
        return;
      }
      if (message.type === 'event' && message.event) {
        view = applyEvent(view, message.event);
        paint();
        return;
      }
      if (message.type === 'presence' && message.people && message.machines && message.agents) {
        view = applyPresence(view, { people: message.people, machines: message.machines, agents: message.agents });
        paint();
        return;
      }
      if (message.type === 'error' && message.error) formError.textContent = message.error;
    });
    ws.addEventListener('close', () => {
      if (mine !== generation) return;
      link = 'Reconnecting';
      paintWho();
      window.setTimeout(connect, 1000);
    });
  }

  async function refresh(): Promise<void> {
    try {
      const next = await loadSnapshot(session);
      if (next.cursor >= view.cursor) {
        me = next.me;
        view = applySnapshot(next);
      }
      paint();
    } catch {
      link = 'Reconnecting';
      paintWho();
    }
  }
}

function mountInvites(box: HTMLElement, session: string, formError: HTMLElement): void {
  const personForm = el('form');
  personForm.id = 'person-invite';
  const role = el('select');
  role.id = 'invite-role';
  for (const [value, label] of [
    ['peer', 'Peer'],
    ['observer', 'Observer'],
    ['bot', 'Bot'],
    ['owner', 'Owner'],
  ] as const) {
    const option = el('option', undefined, label);
    option.value = value;
    role.append(option);
  }
  const roleLabel = el('label', undefined, 'Role');
  roleLabel.append(role);
  const personButton = el('button', undefined, 'Invite a person');
  personButton.type = 'submit';
  personForm.append(roleLabel, personButton);

  const machineForm = el('form');
  machineForm.id = 'machine-invite';
  const machine = field('Machine', 'invite-machine');
  machine.input.value = 'backend';
  const agentName = field('Agent', 'invite-agent');
  agentName.input.value = 'coder';
  const project = field('Project', 'invite-project');
  project.input.value = '~/project';
  const machineButton = el('button', undefined, 'Invite a machine');
  machineButton.type = 'submit';
  machineForm.append(machine.label, agentName.label, project.label, machineButton);

  const result = el('pre', 'invite-result');
  result.id = 'invite-result';
  result.hidden = true;
  const copy = el('button', undefined, 'Copy');
  copy.id = 'copy-invite';
  copy.type = 'button';
  copy.hidden = true;
  copy.addEventListener('click', () => {
    const text = result.textContent ?? '';
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(text).catch(() => selectFallback(result));
      return;
    }
    selectFallback(result);
  });

  personForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void createInvite(session, { kind: 'person', role: role.value }, formError).then((invite) => {
      if (!invite?.code) return;
      showInvite(result, copy, `Person invite, ${role.value}, valid until ${invite.expiresAt}\n${invite.code}`);
    });
  });
  machineForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void createInvite(session, { kind: 'machine' }, formError).then((invite) => {
      if (!invite?.code) return;
      const command = [
        'pitwall daemon join',
        location.origin,
        invite.code,
        '--name',
        machine.input.value.trim() || 'backend',
        '--agent',
        agentName.input.value.trim() || 'coder',
        '--runner echo',
        '--project',
        project.input.value.trim() || '~/project',
      ].join(' ');
      showInvite(result, copy, `Machine invite, valid until ${invite.expiresAt}\n${command}`);
    });
  });
  box.append(personForm, machineForm, result, copy);
}

function showInvite(result: HTMLElement, copy: HTMLButtonElement, text: string): void {
  result.hidden = false;
  copy.hidden = false;
  result.textContent = text;
}

async function createInvite(session: string, body: Record<string, string>, formError: HTMLElement): Promise<{ code?: string; expiresAt?: string } | null> {
  const response = await fetch('/api/invites', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json()) as { code?: string; expiresAt?: string; error?: string };
  if (!response.ok) {
    formError.textContent = parsed.error || 'The invite was not created.';
    return null;
  }
  formError.textContent = '';
  return parsed;
}

async function enablePush(session: string): Promise<void> {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    throw new Error('This browser cannot show Pitwall notifications.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications stay off until you allow them.');
  const keyResponse = await fetch('/api/push/key');
  const keyBody = (await keyResponse.json()) as { publicKey?: string | null };
  if (!keyBody.publicKey) throw new Error('This relay has no notification key.');
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(keyBody.publicKey),
  });
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` },
    body: JSON.stringify(subscription),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: string };
    throw new Error(body.error || 'The room did not save this browser.');
  }
}

async function loadSnapshot(session: string): Promise<Snapshot> {
  const response = await fetch('/api/snapshot', { headers: { authorization: `Bearer ${session}` } });
  if (response.status === 401) throw new Error('unauthorized');
  if (!response.ok) throw new Error('The room did not load.');
  return (await response.json()) as Snapshot;
}

function canCancel(me: Person, task: Task): boolean {
  return me.role === 'owner' || (me.role === 'peer' && task.requesterId === me.id);
}

function linkify(parent: HTMLElement, text: string): void {
  const parts = text.split(/(https:\/\/[^\s]+)/g);
  for (const part of parts) {
    const href = part.startsWith('https://') ? safeHttps(part) : null;
    if (href) {
      const anchor = el('a', undefined, href);
      anchor.href = href;
      anchor.target = '_blank';
      anchor.rel = 'noreferrer noopener';
      parent.append(anchor);
    } else parent.append(document.createTextNode(part));
  }
}

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function clock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function day(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toDateString();
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]?.[0], words[1]?.[0]] : [...(words[0] ?? '?')].slice(0, 2);
  return letters.join('').toUpperCase();
}

/** A stable hue for a name, so one sender keeps one colour. */
function hue(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function newClientId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const raw = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return `c${raw}`;
}

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function selectFallback(node: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

function field(labelText: string, id: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = el('label', undefined, labelText);
  const input = el('input');
  input.id = id;
  label.append(input);
  return { label, input };
}

function modeButton(id: string, label: string): HTMLButtonElement {
  const button = el('button', undefined, label);
  button.id = id;
  button.type = 'button';
  return button;
}

function filterButton(id: string, label: string): HTMLButtonElement {
  const button = el('button', undefined, label);
  button.id = `filter-${id}`;
  button.type = 'button';
  return button;
}

function navButton(id: string, label: string): HTMLButtonElement {
  const button = el('button', undefined, label);
  button.id = id;
  button.type = 'button';
  return button;
}

/** The brand line: the mark and the name. */
function brand(): HTMLDivElement {
  const mark = el('div', 'mark');
  const logo = el('img', 'logo');
  logo.src = '/favicon.svg';
  logo.alt = '';
  logo.width = 22;
  logo.height = 22;
  mark.append(logo, el('span', undefined, 'Pitwall'));
  return mark;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
