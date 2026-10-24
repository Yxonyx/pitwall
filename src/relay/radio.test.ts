import { expect, test } from 'vitest';
import { assertRepo, parseIssueList, parseRadioComments } from './radio.js';

test('the newest open radio issue wins', () => {
  expect(parseIssueList('[{"number":14},{"number":2010},{"number":8}]')).toEqual({ number: 2010 });
  expect(parseIssueList('[]')).toBeNull();
});

test('comments keep an id, a body, and an author', () => {
  const raw = JSON.stringify({
    data: {
      repository: {
        issue: {
          comments: {
            nodes: [
              { databaseId: 42, body: 'Ship the room.', url: 'https://github.com/acme/app/issues/1#issuecomment-42', updatedAt: '2026-10-24T00:00:00Z', author: { login: 'ada' } },
              { body: 'missing id' },
            ],
          },
        },
      },
    },
  });
  expect(parseRadioComments(raw)).toEqual([
    {
      id: '42',
      body: 'Ship the room.',
      url: 'https://github.com/acme/app/issues/1#issuecomment-42',
      actor: 'ada',
      updatedAt: '2026-10-24T00:00:00Z',
    },
  ]);
});

test('a radio repo is owner/name', () => {
  expect(assertRepo('Yxonyx/pitwall')).toEqual({ owner: 'Yxonyx', name: 'pitwall' });
  expect(() => assertRepo('not a repo')).toThrow(/owner\/name/);
});
