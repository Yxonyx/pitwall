import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { nowIso } from '../shared/ids.js';
import type { LocalRun } from './decide.js';

interface RunRow {
  task_id: string;
  state: LocalRun['state'];
  result: string | null;
  error: string | null;
  question: string | null;
  last_input_id: string | null;
  session_id: string | null;
}

function mapRun(row: RunRow): LocalRun {
  return {
    state: row.state,
    result: row.result,
    error: row.error,
    question: row.question,
    lastInputId: row.last_input_id,
    sessionId: row.session_id,
  };
}

export class RunStore {
  private constructor(private readonly db: DatabaseSync) {}

  static open(file: string): RunStore {
    mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec(`
      create table if not exists runs (
        task_id text primary key,
        state text not null,
        result text,
        error text,
        question text,
        last_input_id text,
        session_id text,
        updated_at text not null
      );
    `);
    return new RunStore(db);
  }

  close(): void {
    this.db.close();
  }

  get(taskId: string): LocalRun | null {
    const row = this.db.prepare('select * from runs where task_id = ?').get(taskId) as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  claim(taskId: string): boolean {
    try {
      this.db
        .prepare('insert into runs (task_id, state, updated_at) values (?, ?, ?)')
        .run(taskId, 'running', nowIso());
      return true;
    } catch {
      return false;
    }
  }

  save(taskId: string, patch: Partial<LocalRun> & { state: LocalRun['state'] }): void {
    const current = this.get(taskId);
    const next: LocalRun = {
      state: patch.state,
      result: patch.result !== undefined ? patch.result : (current?.result ?? null),
      error: patch.error !== undefined ? patch.error : (current?.error ?? null),
      question: patch.question !== undefined ? patch.question : (current?.question ?? null),
      lastInputId: patch.lastInputId !== undefined ? patch.lastInputId : (current?.lastInputId ?? null),
      sessionId: patch.sessionId !== undefined ? patch.sessionId : (current?.sessionId ?? null),
    };
    if (!current) {
      this.db
        .prepare(
          `insert into runs (task_id, state, result, error, question, last_input_id, session_id, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(taskId, next.state, next.result, next.error, next.question, next.lastInputId, next.sessionId, nowIso());
      return;
    }
    this.db
      .prepare(
        `update runs set state = ?, result = ?, error = ?, question = ?, last_input_id = ?, session_id = ?, updated_at = ?
         where task_id = ?`,
      )
      .run(next.state, next.result, next.error, next.question, next.lastInputId, next.sessionId, nowIso(), taskId);
  }
}
