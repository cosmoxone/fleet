import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatSessionsContainer from './ChatSessionsContainer';
import { getAcpDriver, subscribeToAcpRecovery } from '../acp/acpConnection';
import { acpChatSessionController } from '../acp/chatSessionController';

const navigate = vi.fn();

vi.mock('react-router', () => ({
  useSearchParams: () => [new URLSearchParams('resumeSessionId=session-1')],
  useNavigate: () => navigate,
}));

vi.mock('./BaseChat', () => ({
  default: ({ sessionId }: { sessionId: string }) => <div>{sessionId}</div>,
}));

vi.mock('../acp/acpConnection', () => ({
  subscribeToAcpRecovery: vi.fn(),
  getAcpDriver: vi.fn().mockResolvedValue('goose'),
}));

vi.mock('../acp/chatSessionController', () => ({
  acpChatSessionController: {
    restoreSession: vi.fn().mockResolvedValue(undefined),
    replaceWithFreshSession: vi.fn().mockResolvedValue('fresh-session-1'),
  },
}));

function fireRecoveryDone() {
  let onRecoveryChanged: ((recovering: boolean) => void) | undefined;
  vi.mocked(subscribeToAcpRecovery).mockImplementation((listener) => {
    onRecoveryChanged = listener;
    return () => undefined;
  });
  render(
    <ChatSessionsContainer
      setChat={vi.fn()}
      activeSessions={[{ sessionId: 'session-1' }, { sessionId: 'session-2' }]}
    />
  );
  onRecoveryChanged?.(false);
}

describe('ChatSessionsContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAcpDriver).mockResolvedValue('goose');
  });

  it('restores active chat sessions after ACP reconnects (goose: resume policy)', async () => {
    fireRecoveryDone();
    // The policy lookup is async; let microtasks settle before asserting.
    await vi.waitFor(() => {
      expect(acpChatSessionController.restoreSession).toHaveBeenCalledTimes(2);
    });
    expect(acpChatSessionController.restoreSession).toHaveBeenCalledWith('session-1');
    expect(acpChatSessionController.restoreSession).toHaveBeenCalledWith('session-2');
    expect(acpChatSessionController.replaceWithFreshSession).not.toHaveBeenCalled();
  });

  it('replaces sessions with fresh ones for fresh-session drivers (dsh, 5B F-2)', async () => {
    vi.mocked(getAcpDriver).mockResolvedValue('dsh');
    fireRecoveryDone();

    await vi.waitFor(() => {
      expect(acpChatSessionController.replaceWithFreshSession).toHaveBeenCalledTimes(2);
    });
    expect(acpChatSessionController.replaceWithFreshSession).toHaveBeenCalledWith('session-1');
    expect(acpChatSessionController.replaceWithFreshSession).toHaveBeenCalledWith('session-2');
    expect(acpChatSessionController.restoreSession).not.toHaveBeenCalled();

    // The window's current session (session-1) navigates to its replacement.
    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(
        '/pair?resumeSessionId=fresh-session-1',
        expect.objectContaining({ state: { disableAnimation: true } })
      );
    });
  });

  it('falls back to restore when the driver lookup fails (catalog unavailable)', async () => {
    vi.mocked(getAcpDriver).mockRejectedValue(new Error('no driver'));
    fireRecoveryDone();
    await vi.waitFor(() => {
      expect(acpChatSessionController.restoreSession).toHaveBeenCalledTimes(2);
    });
  });
});
