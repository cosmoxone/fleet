import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FleetNodesSection from '../settings/app/FleetNodesSection';
import { IntlTestWrapper } from '../../i18n/test-utils';
import type { FleetNodeConfig } from '../../utils/settings';

const renderWithIntl = (ui: React.ReactElement) => render(ui, { wrapper: IntlTestWrapper });

const node = (overrides: Partial<FleetNodeConfig> = {}): FleetNodeConfig => ({
  id: 'node-1',
  name: 'dev-box',
  url: 'https://192.168.1.11:3284',
  secret: 'secret-1',
  ...overrides,
});

const electron = () =>
  window.electron as unknown as {
    getSetting: ReturnType<typeof vi.fn>;
    setSetting: ReturnType<typeof vi.fn>;
  };

describe('FleetNodesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders configured nodes from settings', async () => {
    electron().getSetting.mockResolvedValueOnce([node()]);
    renderWithIntl(<FleetNodesSection />);
    expect(await screen.findByDisplayValue('dev-box')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://192.168.1.11:3284')).toBeInTheDocument();
  });

  it('shows an empty hint when no nodes exist', async () => {
    electron().getSetting.mockResolvedValueOnce([]);
    renderWithIntl(<FleetNodesSection />);
    expect(await screen.findByText(/No fleet nodes configured yet/i)).toBeInTheDocument();
  });

  it('adds a draft node and persists the list', async () => {
    const user = userEvent.setup();
    electron().getSetting.mockResolvedValueOnce([]);
    electron().setSetting.mockResolvedValueOnce(undefined);
    renderWithIntl(<FleetNodesSection />);

    await user.click(await screen.findByRole('button', { name: /add node/i }));

    await waitFor(() => {
      expect(electron().setSetting).toHaveBeenCalledWith('externalBackends', [
        expect.objectContaining({ name: '', url: '', secret: '' }),
      ]);
    });
  });

  it('deletes a node and persists the remaining list', async () => {
    const user = userEvent.setup();
    electron().getSetting.mockResolvedValueOnce([node(), node({ id: 'n2', name: 'ci' })]);
    electron().setSetting.mockResolvedValueOnce(undefined);
    renderWithIntl(<FleetNodesSection />);

    const deleteButtons = await screen.findAllByRole('button', { name: /delete/i });
    await user.click(deleteButtons[0]);

    await waitFor(() => {
      expect(electron().setSetting).toHaveBeenCalledWith(
        'externalBackends',
        expect.arrayContaining([expect.objectContaining({ id: 'n2' })])
      );
      const saved = electron().setSetting.mock.calls[
        electron().setSetting.mock.calls.length - 1
      ]?.[1] as FleetNodeConfig[];
      expect(saved).toHaveLength(1);
    });
  });

  it('shows a validation error for a malformed url and skips saving it', async () => {
    const user = userEvent.setup();
    electron().getSetting.mockResolvedValueOnce([node()]);
    renderWithIntl(<FleetNodesSection />);

    const urlInput = await screen.findByDisplayValue('https://192.168.1.11:3284');
    await user.clear(urlInput);
    await user.type(urlInput, 'not a url');

    expect(await screen.findByText(/Invalid URL format/i)).toBeInTheDocument();
    expect(electron().setSetting).not.toHaveBeenCalled();
  });

  it('rejects a fingerprint on an http url', async () => {
    const user = userEvent.setup();
    electron().getSetting.mockResolvedValueOnce([node()]);
    renderWithIntl(<FleetNodesSection />);

    const urlInput = await screen.findByDisplayValue('https://192.168.1.11:3284');
    await user.clear(urlInput);
    await user.type(urlInput, 'http://192.168.1.11:3284');

    const fingerprintInput = screen.getByPlaceholderText('AA:BB:CC:...');
    await user.type(fingerprintInput, 'AA:BB');

    expect(await screen.findByText(/requires an https URL/i)).toBeInTheDocument();
  });
});
