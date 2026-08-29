import { useEffect, useState } from 'react';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import { FleetNodeConfig } from '../../../utils/settings';
import { FleetNodeValidationError, validateFleetNode } from '../../../utils/fleet';
import { defineMessages, useIntl } from '../../../i18n';
import { v4 as uuidv4 } from 'uuid';

const i18n = defineMessages({
  title: {
    id: 'fleetNodesSection.title',
    defaultMessage: 'Fleet Nodes',
  },
  description: {
    id: 'fleetNodesSection.description',
    defaultMessage:
      'Remote goose servers you can open chat windows on via File → New Chat on Node…',
  },
  empty: {
    id: 'fleetNodesSection.empty',
    defaultMessage: 'No fleet nodes configured yet. Add one to enable per-node chat windows.',
  },
  addNode: {
    id: 'fleetNodesSection.addNode',
    defaultMessage: 'Add Node',
  },
  nodeName: {
    id: 'fleetNodesSection.nodeName',
    defaultMessage: 'Name',
  },
  nodeNamePlaceholder: {
    id: 'fleetNodesSection.nodeNamePlaceholder',
    defaultMessage: 'dev-box',
  },
  serverUrl: {
    id: 'fleetNodesSection.serverUrl',
    defaultMessage: 'Backend Base URL',
  },
  secretKey: {
    id: 'fleetNodesSection.secretKey',
    defaultMessage: 'Secret Key',
  },
  secretKeyPlaceholder: {
    id: 'fleetNodesSection.secretKeyPlaceholder',
    defaultMessage: 'GOOSE_SERVER__SECRET_KEY on the node',
  },
  certFingerprint: {
    id: 'fleetNodesSection.certFingerprint',
    defaultMessage: 'Certificate Fingerprint (optional, TOFU if empty)',
  },
  workingDir: {
    id: 'fleetNodesSection.workingDir',
    defaultMessage: 'Remote Working Directory (optional)',
  },
  workingDirPlaceholder: {
    id: 'fleetNodesSection.workingDirPlaceholder',
    defaultMessage: '/home/goose/workspace',
  },
  deleteNode: {
    id: 'fleetNodesSection.deleteNode',
    defaultMessage: 'Delete',
  },
  urlProtocolError: {
    id: 'fleetNodesSection.urlProtocolError',
    defaultMessage: 'URL must use http or https protocol',
  },
  fingerprintRequiresHttps: {
    id: 'fleetNodesSection.fingerprintRequiresHttps',
    defaultMessage: 'Certificate fingerprint requires an https URL',
  },
  urlFormatError: {
    id: 'fleetNodesSection.urlFormatError',
    defaultMessage: 'Invalid URL format',
  },
  urlBaseError: {
    id: 'fleetNodesSection.urlBaseError',
    defaultMessage:
      'URL must be the backend base URL before /acp, without query parameters or fragments',
  },
  nameRequired: {
    id: 'fleetNodesSection.nameRequired',
    defaultMessage: 'Name is required',
  },
});

const VALIDATION_MESSAGES: Record<
  Exclude<FleetNodeValidationError, 'nameRequired'>,
  keyof typeof i18n
> = {
  urlProtocol: 'urlProtocolError',
  urlBase: 'urlBaseError',
  urlFormat: 'urlFormatError',
  fingerprintRequiresHttps: 'fingerprintRequiresHttps',
};

function validateNode(intl: ReturnType<typeof useIntl>, node: FleetNodeConfig): string | null {
  const error = validateFleetNode(node);
  if (!error) {
    return null;
  }
  if (error === 'nameRequired') {
    return intl.formatMessage(i18n.nameRequired);
  }
  return intl.formatMessage(i18n[VALIDATION_MESSAGES[error]]);
}

export default function FleetNodesSection() {
  const intl = useIntl();
  const [nodes, setNodes] = useState<FleetNodeConfig[]>([]);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      const externalBackends = await window.electron.getSetting('externalBackends');
      setNodes(externalBackends ?? []);
    };
    loadSettings();
  }, []);

  const saveNodes = async (next: FleetNodeConfig[]) => {
    setNodes(next);
    setIsSaving(true);
    try {
      await window.electron.setSetting('externalBackends', next);
    } catch (error) {
      console.error('Failed to save fleet nodes:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const updateNode = <K extends keyof FleetNodeConfig>(
    id: string,
    field: K,
    value: FleetNodeConfig[K]
  ) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    const updated = { ...node, [field]: value };
    setErrors((prev) => ({ ...prev, [id]: validateNode(intl, updated) }));
    setNodes((prev) => prev.map((n) => (n.id === id ? updated : n)));
  };

  const commitNode = async (id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    const error = validateNode(intl, node);
    setErrors((prev) => ({ ...prev, [id]: error }));
    if (!error) {
      await saveNodes(nodes);
    }
  };

  const addNode = async () => {
    const draft: FleetNodeConfig = {
      id: uuidv4(),
      name: '',
      url: '',
      secret: '',
    };
    await saveNodes([...nodes, draft]);
  };

  const deleteNode = async (id: string) => {
    await saveNodes(nodes.filter((n) => n.id !== id));
  };

  return (
    <section id="fleet-nodes" className="space-y-4 pr-4 mt-1">
      <Card className="pb-2">
        <CardHeader className="pb-0">
          <CardTitle>{intl.formatMessage(i18n.title)}</CardTitle>
          <CardDescription>{intl.formatMessage(i18n.description)}</CardDescription>
        </CardHeader>
        <CardContent className="pt-4 space-y-4 px-4">
          {nodes.length === 0 && (
            <p className="text-xs text-text-secondary">{intl.formatMessage(i18n.empty)}</p>
          )}
          {nodes.map((node) => (
            <div key={node.id} className="border rounded-md p-3 space-y-3">
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-2">
                  <label htmlFor={`fleet-name-${node.id}`} className="text-text-primary text-xs">
                    {intl.formatMessage(i18n.nodeName)}
                  </label>
                  <Input
                    id={`fleet-name-${node.id}`}
                    type="text"
                    placeholder={intl.formatMessage(i18n.nodeNamePlaceholder)}
                    value={node.name}
                    onChange={(e) => updateNode(node.id, 'name', e.target.value)}
                    onBlur={() => commitNode(node.id)}
                    disabled={isSaving}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => deleteNode(node.id)}
                  disabled={isSaving}
                  title={intl.formatMessage(i18n.deleteNode)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
              <div className="space-y-2">
                <label htmlFor={`fleet-url-${node.id}`} className="text-text-primary text-xs">
                  {intl.formatMessage(i18n.serverUrl)}
                </label>
                <Input
                  id={`fleet-url-${node.id}`}
                  type="url"
                  placeholder="https://192.168.1.11:3284"
                  value={node.url}
                  onChange={(e) => updateNode(node.id, 'url', e.target.value)}
                  onBlur={() => commitNode(node.id)}
                  disabled={isSaving}
                  className={errors[node.id] ? 'border-red-500' : ''}
                />
              </div>
              {errors[node.id] && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle size={12} />
                  {errors[node.id]}
                </p>
              )}
              <div className="space-y-2">
                <label htmlFor={`fleet-secret-${node.id}`} className="text-text-primary text-xs">
                  {intl.formatMessage(i18n.secretKey)}
                </label>
                <Input
                  id={`fleet-secret-${node.id}`}
                  type="password"
                  placeholder={intl.formatMessage(i18n.secretKeyPlaceholder)}
                  value={node.secret}
                  onChange={(e) => updateNode(node.id, 'secret', e.target.value)}
                  onBlur={() => commitNode(node.id)}
                  disabled={isSaving}
                />
              </div>
              <div className="space-y-2">
                <label
                  htmlFor={`fleet-fingerprint-${node.id}`}
                  className="text-text-primary text-xs"
                >
                  {intl.formatMessage(i18n.certFingerprint)}
                </label>
                <Input
                  id={`fleet-fingerprint-${node.id}`}
                  type="text"
                  placeholder="AA:BB:CC:..."
                  value={node.certFingerprint || ''}
                  onChange={(e) => updateNode(node.id, 'certFingerprint', e.target.value)}
                  onBlur={() => commitNode(node.id)}
                  disabled={isSaving}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor={`fleet-workdir-${node.id}`} className="text-text-primary text-xs">
                  {intl.formatMessage(i18n.workingDir)}
                </label>
                <Input
                  id={`fleet-workdir-${node.id}`}
                  type="text"
                  placeholder={intl.formatMessage(i18n.workingDirPlaceholder)}
                  value={node.workingDir || ''}
                  onChange={(e) => updateNode(node.id, 'workingDir', e.target.value)}
                  onBlur={() => commitNode(node.id)}
                  disabled={isSaving}
                />
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addNode} disabled={isSaving}>
            <Plus size={14} className="mr-1" />
            {intl.formatMessage(i18n.addNode)}
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
