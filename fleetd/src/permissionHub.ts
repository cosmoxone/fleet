import { randomUUID } from 'node:crypto';

/**
 * FLEET-HUB-001 M1 — permission hub: the face-④ fan-out primitive.
 *
 * Attached dispatches park their backend permission requests here instead of
 * answering deny-first: every listener (SSE /events consumer — future
 * companion/desktop face, or plain curl) may answer; the deadline expires to
 * `cancelled` (deny) so unattended hubs stay safe.
 */

export interface PendingPermission {
  id: string;
  node: string;
  sessionId: string;
  toolName?: string;
  options: Array<{ optionId: string; name?: string; kind?: string }>;
  receivedAt: number;
  deadlineMs: number;
}

export interface PermissionAnswer {
  outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' };
}

type Waiter = (answer: PermissionAnswer) => void;

export class PermissionHub {
  private readonly pending = new Map<string, PendingPermission>();
  private readonly waiters = new Map<string, Waiter>();
  private readonly listeners = new Set<(event: string, payload: unknown) => void>();
  answered = 0;
  expired = 0;

  /** SSE/event listeners: 'permission_pending' | 'permission_settled'. */
  onEvent(listener: (event: string, payload: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: string, payload: unknown): void {
    for (const listener of this.listeners) {
      listener(event, payload);
    }
  }

  /**
   * Parks a permission request and resolves when answered or expired.
   * Returns the ACP response to forward to the backend.
   */
  async wait(
    request: Omit<PendingPermission, 'id' | 'receivedAt' | 'deadlineMs'> & { deadlineMs?: number }
  ): Promise<PermissionAnswer> {
    const entry: PendingPermission = {
      ...request,
      id: randomUUID(),
      receivedAt: Date.now(),
      deadlineMs: request.deadlineMs ?? 60_000,
    };
    this.pending.set(entry.id, entry);
    this.emit('permission_pending', entry);

    return new Promise<PermissionAnswer>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(entry.id)) {
          this.expired += 1;
          this.emit('permission_settled', { id: entry.id, via: 'expired' });
          resolve({ outcome: { outcome: 'cancelled' } });
        }
      }, entry.deadlineMs);

      this.waiters.set(entry.id, (answer) => {
        clearTimeout(timer);
        this.pending.delete(entry.id);
        this.answered += 1;
        this.emit('permission_settled', {
          id: entry.id,
          via: answer.outcome.outcome === 'selected' ? 'answered' : 'cancelled',
        });
        resolve(answer);
      });
    });
  }

  /** Answers a pending request (face ④ entry point). */
  answer(id: string, answer: PermissionAnswer): boolean {
    const waiter = this.waiters.get(id);
    if (!waiter) {
      return false;
    }
    this.waiters.delete(id);
    waiter(answer);
    return true;
  }

  list(): PendingPermission[] {
    return [...this.pending.values()];
  }
}
