import { describe, expect, it, vi } from 'vitest';
import { PermissionHub } from '../src/permissionHub';

describe('PermissionHub (M1 face-④ primitive)', () => {
  it('parks a request, fans out an event, and resolves on answer', async () => {
    const hub = new PermissionHub();
    const events: string[] = [];
    hub.onEvent((event) => events.push(event));

    const pending = hub.wait({
      node: 'dsh-local',
      sessionId: 's1',
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
      deadlineMs: 5000,
    });

    await vi.waitFor(() => expect(hub.list()).toHaveLength(1));
    expect(events).toEqual(['permission_pending']);
    const entry = hub.list()[0]!;
    expect(entry.options[0]!.optionId).toBe('allow');

    expect(hub.answer(entry.id, { outcome: { outcome: 'selected', optionId: 'allow' } })).toBe(true);
    const answer = await pending;
    expect(answer).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    expect(hub.answered).toBe(1);
    expect(hub.list()).toHaveLength(0);
    expect(events).toEqual(['permission_pending', 'permission_settled']);
  });

  it('expires unanswered requests to cancelled (safe default)', async () => {
    const hub = new PermissionHub();
    const answer = await hub.wait({
      node: 'n',
      sessionId: 's',
      options: [{ optionId: 'x' }],
      deadlineMs: 30,
    });
    expect(answer).toEqual({ outcome: { outcome: 'cancelled' } });
    expect(hub.expired).toBe(1);
  });

  it('answering an unknown/already-settled id returns false', () => {
    const hub = new PermissionHub();
    expect(hub.answer('missing', { outcome: { outcome: 'cancelled' } })).toBe(false);
  });
});
