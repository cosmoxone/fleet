import { normalizeAcpHttpBaseUrl } from './url';

export interface FleetNode {
  id: string;
  name: string;
  url: string;
  secret: string;
  certFingerprint?: string;
  workingDir?: string;
  /** Backend driver id. Omitted means the default driver. */
  driver?: string;
}

export const DEFAULT_DRIVER_ID = 'goose';

export function effectiveDriverId(node: FleetNode): string {
  return node.driver ?? DEFAULT_DRIVER_ID;
}

export type FleetNodeValidationError =
  | 'nameRequired'
  | 'urlProtocol'
  | 'urlBase'
  | 'urlFormat'
  | 'fingerprintRequiresHttps';

export function validateFleetNode(node: FleetNode): FleetNodeValidationError | null {
  if (!node.name.trim()) {
    return 'nameRequired';
  }
  if (!node.url.trim()) {
    return null;
  }
  try {
    const normalizedUrl = normalizeAcpHttpBaseUrl(node.url);
    const parsed = new URL(normalizedUrl);
    if (node.certFingerprint?.trim() && parsed.protocol !== 'https:') {
      return 'fingerprintRequiresHttps';
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('http: or https:')) {
      return 'urlProtocol';
    }
    if (
      message.includes('base URL before /acp') ||
      message.includes('query parameters or fragments')
    ) {
      return 'urlBase';
    }
    return 'urlFormat';
  }
}
