import type { WebSocket } from 'ws';

export class Hub {
  private readonly people = new Map<string, Set<WebSocket>>();
  private readonly machines = new Map<string, WebSocket>();

  addPerson(userId: string, socket: WebSocket): void {
    let set = this.people.get(userId);
    if (!set) {
      set = new Set();
      this.people.set(userId, set);
    }
    set.add(socket);
  }

  removePerson(userId: string, socket: WebSocket): boolean {
    const set = this.people.get(userId);
    if (!set) return false;
    set.delete(socket);
    if (set.size === 0) {
      this.people.delete(userId);
      return true;
    }
    return false;
  }

  personCount(userId: string): number {
    return this.people.get(userId)?.size ?? 0;
  }

  setMachine(machineId: string, socket: WebSocket): void {
    const previous = this.machines.get(machineId);
    if (previous && previous !== socket) previous.close();
    this.machines.set(machineId, socket);
  }

  clearMachine(machineId: string, socket: WebSocket): void {
    if (this.machines.get(machineId) === socket) this.machines.delete(machineId);
  }

  machine(machineId: string): WebSocket | undefined {
    return this.machines.get(machineId);
  }

  sendMachine(machineId: string, message: unknown): void {
    const socket = this.machines.get(machineId);
    if (!socket || socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  broadcast(message: unknown): void {
    const raw = JSON.stringify(message);
    for (const sockets of this.people.values()) {
      for (const socket of sockets) {
        if (socket.readyState === socket.OPEN) socket.send(raw);
      }
    }
  }

  closeAll(): void {
    for (const sockets of this.people.values()) {
      for (const socket of sockets) socket.close();
    }
    for (const socket of this.machines.values()) socket.close();
    this.people.clear();
    this.machines.clear();
  }
}
