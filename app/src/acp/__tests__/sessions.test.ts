import { methods, RequestError, type SessionInfo } from '@agentclientprotocol/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAcpClient, getAcpDriver } from '../acpConnection';
import {
  acpGetSessionListItem,
  acpListRecentSessions,
  acpListSessions,
  acpLoadSession,
  acpNewSession,
  sessionInfoToSession,
} from '../sessions';

vi.mock('../acpConnection', () => ({
  getAcpClient: vi.fn(),
  getAcpDriver: vi.fn(async () => 'goose'),
}));

function sessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: 'session-1',
    cwd: '/tmp',
    title: 'Scheduled session',
    updatedAt: '2026-01-01T00:00:00Z',
    _meta: {
      createdAt: '2026-01-01T00:00:00Z',
      messageCount: 0,
      sessionType: 'scheduled',
    },
    ...overrides,
  } as unknown as SessionInfo;
}

describe('ACP sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves session type from ACP session info metadata', () => {
    const session = sessionInfoToSession(sessionInfo());

    expect(session.session_type).toBe('scheduled');
  });

  it('does not synthesize a title when ACP omits one', () => {
    const session = sessionInfoToSession(sessionInfo({ title: undefined }));

    expect(session.name).toBe('');
  });

  it('returns session info refreshed after loading the ACP session', async () => {
    const loadedSessionInfo = sessionInfo({
      _meta: {
        createdAt: '2026-01-01T00:00:00Z',
        messageCount: 0,
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
      },
    });
    const client = {
      connection: {
        agent: {
          request: vi.fn().mockResolvedValue({}),
        },
      },
      goose: {
        sessionInfo_unstable: vi
          .fn()
          .mockResolvedValueOnce({ session: sessionInfo() })
          .mockResolvedValueOnce({ session: loadedSessionInfo }),
      },
    };
    vi.mocked(getAcpClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof getAcpClient>>
    );

    const result = await acpLoadSession('session-1');

    expect(client.connection.agent.request).toHaveBeenCalledWith(methods.agent.session.load, {
      sessionId: 'session-1',
      cwd: '/tmp',
      mcpServers: [],
    });
    expect(client.goose.sessionInfo_unstable).toHaveBeenCalledTimes(2);
    expect(result.sessionInfo).toBe(loadedSessionInfo);
    expect(sessionInfoToSession(result.sessionInfo).provider_name).toBe('anthropic');
    expect(sessionInfoToSession(result.sessionInfo).model_config?.model_name).toBe(
      'claude-sonnet-4-5'
    );
  });

  it('carries the recipe parameter scope id in new-session metadata', async () => {
    const createdSessionInfo = sessionInfo();
    const client = {
      connection: {
        agent: {
          request: vi.fn().mockResolvedValue({ sessionId: 'session-1' }),
        },
      },
      goose: {
        sessionInfo_unstable: vi.fn().mockResolvedValue({ session: createdSessionInfo }),
      },
    };
    vi.mocked(getAcpClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof getAcpClient>>
    );

    await acpNewSession('/tmp', [], {
      recipeDeeplink: 'goose://recipe?url=example',
      recipeParameterScopeId: 'scope-1',
    });

    expect(client.connection.agent.request).toHaveBeenCalledWith(methods.agent.session.new, {
      cwd: '/tmp',
      mcpServers: [],
      _meta: {
        client: 'goose-desktop',
        recipeDeeplink: 'goose://recipe?url=example',
        recipeParameterScopeId: 'scope-1',
      },
    });
  });

  it('returns a list item from ACP session info', async () => {
    const client = {
      goose: {
        sessionInfo_unstable: vi.fn().mockResolvedValue({
          session: sessionInfo({
            title: 'Subagent session',
            _meta: {
              createdAt: '2026-01-01T00:00:00Z',
              lastMessageAt: '2026-01-01T00:01:00Z',
              messageCount: 3,
              sessionType: 'sub_agent',
              providerId: 'anthropic',
              modelId: 'claude-sonnet-4-5',
            },
          }),
        }),
      },
    };
    vi.mocked(getAcpClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof getAcpClient>>
    );

    const item = await acpGetSessionListItem('session-1');

    expect(client.goose.sessionInfo_unstable).toHaveBeenCalledWith({ sessionId: 'session-1' });
    expect(item).toMatchObject({
      id: 'session-1',
      name: 'Subagent session',
      workingDir: '/tmp',
      messageCount: 3,
      lastMessageAt: '2026-01-01T00:01:00Z',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
    });
  });
});

describe('non-goose drivers (dsh)', () => {
  beforeEach(() => {
    vi.mocked(getAcpDriver).mockResolvedValue('dsh');
  });

  afterEach(() => {
    vi.mocked(getAcpDriver).mockResolvedValue('goose');
  });

  it('creates a session on the standard ACP face without goose metadata', async () => {
    const client = {
      connection: {
        agent: {
          request: vi.fn().mockResolvedValue({ sessionId: 'session-1' }),
        },
      },
      goose: {
        sessionInfo_unstable: vi.fn(),
      },
    };
    vi.mocked(getAcpClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof getAcpClient>>
    );

    const result = await acpNewSession('/tmp', []);

    expect(client.connection.agent.request).toHaveBeenCalledWith(methods.agent.session.new, {
      cwd: '/tmp',
      mcpServers: [],
    });
    expect(client.goose.sessionInfo_unstable).not.toHaveBeenCalled();
    expect(result.sessionId).toBe('session-1');
    expect(result.sessionInfo.cwd).toBe('/tmp');
    expect(result.meta).toEqual({});
    const session = sessionInfoToSession(result.sessionInfo);
    expect(session.model_config?.model_name).toBe('remote (cordis.yml)');
  });

  it('degrades session.list to an empty page when the method is missing', async () => {
    const client = {
      connection: {
        agent: {
          request: vi.fn().mockRejectedValue(new RequestError(-32601, 'Method not found')),
        },
      },
    };
    vi.mocked(getAcpClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof getAcpClient>>
    );

    await expect(acpListSessions()).resolves.toEqual({ sessions: [], nextCursor: null });
    await expect(acpListRecentSessions(5)).resolves.toEqual([]);
  });

  it('still surfaces real session.list errors', async () => {
    const client = {
      connection: {
        agent: {
          request: vi.fn().mockRejectedValue(new RequestError(-32000, 'auth required')),
        },
      },
    };
    vi.mocked(getAcpClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof getAcpClient>>
    );

    await expect(acpListSessions()).rejects.toBeInstanceOf(RequestError);
  });
});
