import { FormattedMessage } from 'react-intl';
import { useNavigate } from 'react-router';
import { Button } from './ui/button';
import { useFleetAppCapabilities, type FleetAppCapabilities } from '../hooks/useFleetAppCapabilities';

/**
 * Route-level capability gate (F-2 S3): renders children only when the
 * current window's driver declares the capability; otherwise a friendly
 * empty state replaces the view — the runtime -32601 softening stays as the
 * second line of defense. Gating at the route covers every nav entry that
 * leads here.
 */
export default function CapabilityRoute({
  flag,
  children,
}: {
  flag: keyof Pick<
    FleetAppCapabilities,
    'sessionList' | 'providers' | 'recipes' | 'schedules' | 'mcpApps' | 'steer'
  >;
  children: React.ReactNode;
}) {
  const caps = useFleetAppCapabilities();
  const navigate = useNavigate();

  if (!caps[flag]) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
        <h2 className="text-lg font-light">
          <FormattedMessage id="capabilityRoute.unsupported.title" />
        </h2>
        <p className="text-text-muted text-sm max-w-md">
          <FormattedMessage
            id="capabilityRoute.unsupported.description"
            values={{ modelLabel: caps.modelLabel ?? '' }}
          />
        </p>
        <Button onClick={() => navigate('/')}>
          <FormattedMessage id="capabilityRoute.backToChat" />
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
