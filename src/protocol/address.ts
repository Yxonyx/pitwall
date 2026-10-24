export interface AgentRef {
  id: string;
  name: string;
  machineName: string;
}

export type AddressHit =
  | { kind: 'none' }
  | { kind: 'all' }
  | { kind: 'agent'; agentId: string }
  | { kind: 'ambiguous'; name: string }
  | { kind: 'unknown'; token: string };

export function parseAddress(body: string, agents: readonly AgentRef[]): AddressHit {
  const match = body.match(/(?:^|\s)@([a-z0-9-]+(?:\/[a-z0-9-]+)?)(?=$|\s)/i);
  const token = match?.[1]?.toLowerCase();
  if (!token) return { kind: 'none' };
  if (token === 'all') return { kind: 'all' };
  if (token.includes('/')) {
    const [machineName, agentName] = token.split('/') as [string, string];
    const found = agents.filter(
      (agent) => agent.machineName.toLowerCase() === machineName && agent.name.toLowerCase() === agentName,
    );
    const only = found[0];
    if (found.length === 1 && only) return { kind: 'agent', agentId: only.id };
    return { kind: 'unknown', token };
  }
  const found = agents.filter((agent) => agent.name.toLowerCase() === token);
  const only = found[0];
  if (found.length === 1 && only) return { kind: 'agent', agentId: only.id };
  if (found.length > 1) return { kind: 'ambiguous', name: token };
  return { kind: 'unknown', token };
}
