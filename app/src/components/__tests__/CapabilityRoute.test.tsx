import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CapabilityRoute from '../CapabilityRoute';
import { getAcpDriver } from '../../acp/acpConnection';
import { fleetDriverCapabilities } from '../../utils/fleet';
import { __resetFleetAppCapabilitiesForTest } from '../../hooks/useFleetAppCapabilities';

vi.mock('../../acp/acpConnection', () => ({
  getAcpDriver: vi.fn().mockResolvedValue('goose'),
}));

const en = {
  'capabilityRoute.unsupported.title': 'Not available on this node',
  'capabilityRoute.unsupported.description': 'The driver for this node does not support this feature. {modelLabel}',
  'capabilityRoute.backToChat': 'Back to chat',
};

function renderRoute(driver: string) {
  vi.mocked(getAcpDriver).mockResolvedValue(driver);
  return render(
    <IntlProvider locale="en" messages={en}>
      <MemoryRouter>
        <CapabilityRoute flag="recipes">
          <div>RECIPES-VIEW</div>
        </CapabilityRoute>
      </MemoryRouter>
    </IntlProvider>
  );
}

describe('CapabilityRoute (F-2 S3 pre-render gating)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetFleetAppCapabilitiesForTest();
    vi.mocked(getAcpDriver).mockResolvedValue('goose');
  });

  it('renders children for goose (providers/recipes enabled)', async () => {
    renderRoute('goose');
    expect(await screen.findByText('RECIPES-VIEW')).toBeTruthy();
  });

  it('renders the unsupported empty state for dsh (recipes=false) with the catalog model label', async () => {
    renderRoute('dsh');
    expect(await screen.findByText('Not available on this node')).toBeTruthy();
    expect(screen.queryByText('RECIPES-VIEW')).toBeNull();
    // Neutral label from capabilities.json surfaces in the description.
    const label = fleetDriverCapabilities('dsh').app?.modelLabel;
    expect(label).toBe('remote (node-configured)');
  });
});
