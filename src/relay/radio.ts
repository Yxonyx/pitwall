export interface RadioComment {
  id: string;
  body: string;
  url: string;
  actor: string;
  updatedAt: string;
}

export function parseIssueList(stdout: string): { number: number } | null {
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) return null;
  const numbers = parsed.flatMap((item) => {
    if (!item || typeof item !== 'object' || !('number' in item)) return [];
    const number = (item as { number?: unknown }).number;
    return typeof number === 'number' ? [number] : [];
  });
  numbers.sort((a, b) => b - a);
  const number = numbers[0];
  return number ? { number } : null;
}

interface GraphqlCommentNode {
  databaseId?: number;
  body?: string;
  url?: string;
  updatedAt?: string;
  author?: { login?: string } | null;
}

export function parseRadioComments(stdout: string): RadioComment[] {
  const parsed = JSON.parse(stdout) as {
    data?: { repository?: { issue?: { comments?: { nodes?: GraphqlCommentNode[] } } | null } };
  };
  const nodes = parsed.data?.repository?.issue?.comments?.nodes ?? [];
  return nodes.flatMap((node) => {
    if (typeof node.databaseId !== 'number' || typeof node.body !== 'string' || typeof node.url !== 'string') {
      return [];
    }
    return [
      {
        id: String(node.databaseId),
        body: node.body,
        url: node.url,
        actor: node.author?.login || 'github',
        updatedAt: node.updatedAt ?? '',
      },
    ];
  });
}

export function assertRepo(repo: string): { owner: string; name: string } {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repo);
  if (!match?.[1] || !match[2]) {
    throw new Error('A radio repo looks like owner/name.');
  }
  return { owner: match[1], name: match[2] };
}

export async function fetchLatestRadio(
  repo: string,
  run: (args: string[]) => Promise<string>,
): Promise<RadioComment[]> {
  const { owner, name } = assertRepo(repo);
  const list = await run([
    'issue',
    'list',
    '--repo',
    `${owner}/${name}`,
    '--label',
    'radio',
    '--state',
    'open',
    '--limit',
    '5',
    '--json',
    'number',
  ]);
  const issue = parseIssueList(list);
  if (!issue) return [];
  const query = `query { repository(owner:${JSON.stringify(owner)}, name:${JSON.stringify(name)}) { issue(number:${issue.number}) { comments(last:20) { nodes { databaseId body url updatedAt author { login } } } } } }`;
  const comments = await run(['api', 'graphql', '-f', `query=${query}`]);
  return parseRadioComments(comments);
}
