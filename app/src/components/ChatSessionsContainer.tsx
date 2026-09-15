import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import BaseChat from './BaseChat';
import { ChatType } from '../types/chat';
import { UserInput } from '../types/message';
import { subscribeToAcpRecovery, getAcpDriver } from '../acp/acpConnection';
import { acpChatSessionController } from '../acp/chatSessionController';
import { fleetDriverCapabilities, } from '../utils/fleet';
import { fleetAppCapabilities } from '../utils/generated/driverCapabilities';

interface ChatSessionsContainerProps {
  setChat: (chat: ChatType) => void;
  activeSessions: Array<{
    sessionId: string;
    initialMessage?: UserInput;
    noAutoSubmit?: boolean;
  }>;
}

/**
 * Container that mounts ALL active chat sessions to keep them alive.
 * Uses CSS to show/hide sessions based on the current URL parameter.
 * This allows multiple sessions to stream simultaneously in the background.
 */
export default function ChatSessionsContainer({
  setChat,
  activeSessions,
}: ChatSessionsContainerProps) {
  const [searchParams] = useSearchParams();
  const currentSessionId = searchParams.get('resumeSessionId') ?? undefined;

  // Build the list of sessions to render
  let sessionsToRender = activeSessions;

  // If we have a currentSessionId that's not in activeSessions, add it (handles page refresh)
  if (currentSessionId && !activeSessions.some((s) => s.sessionId === currentSessionId)) {
    sessionsToRender = [...activeSessions, { sessionId: currentSessionId }];
  }

  const sessionIdsRef = useRef<string[]>([]);
  sessionIdsRef.current = sessionsToRender.map((session) => session.sessionId);
  const currentSessionIdRef = useRef<string | undefined>(currentSessionId);
  currentSessionIdRef.current = currentSessionId;
  const navigate = useNavigate();

  useEffect(() => {
    return subscribeToAcpRecovery((recovering) => {
      if (recovering) {
        return;
      }
      void (async () => {
        // Post-reconnect strategy comes from the driver capability catalog
        // (F-2): `resume` restores server-side state; `fresh-session`
        // backends (dsh: one session per connection) cannot, so replace the
        // dead session instead of surfacing a load error (5B finding F-2).
        let reconnectPolicy: 'resume' | 'fresh-session' = 'resume';
        try {
          const driver = await getAcpDriver();
          reconnectPolicy = fleetAppCapabilities(
            fleetDriverCapabilities(driver)
          ).reconnectPolicy;
        } catch {
          // Catalog unavailable — fall through with goose default.
        }

        for (const sessionId of sessionIdsRef.current) {
          if (reconnectPolicy === 'fresh-session') {
            void acpChatSessionController
              .replaceWithFreshSession(sessionId)
              .then((newSessionId) => {
                if (currentSessionIdRef.current === sessionId) {
                  navigate(`/pair?resumeSessionId=${newSessionId}`, {
                    state: { disableAnimation: true },
                  });
                }
              })
              .catch((error) => {
                console.error(`Failed to start a fresh session after reconnect:`, error);
              });
          } else {
            void acpChatSessionController.restoreSession(sessionId);
          }
        }
      })();
    });
  }, [navigate]);

  // Always render active sessions to keep SSE connections alive, even when not on /pair route
  if (!currentSessionId && activeSessions.length === 0) {
    return null;
  }

  return (
    <div className="relative w-full h-full">
      {sessionsToRender.map((session) => {
        const isVisible = session.sessionId === currentSessionId;

        return (
          <div
            key={session.sessionId}
            className={`absolute inset-0 ${isVisible ? 'block' : 'hidden'}`}
            data-session-id={session.sessionId}
          >
            <BaseChat
              setChat={setChat}
              sessionId={session.sessionId}
              initialMessage={session.initialMessage}
              noAutoSubmit={session.noAutoSubmit}
              suppressEmptyState={false}
              isActiveSession={isVisible}
            />
          </div>
        );
      })}
    </div>
  );
}
