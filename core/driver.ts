import type { FleetNode } from './node';

export interface DriverCapabilities {
  protocol: 'acp';
  transports: readonly ('http-websocket' | 'stdio')[];
  tlsCertificatePinning: boolean;
  localProvisioning: boolean;
}

export interface HealthReport {
  ok: boolean;
  detail?: string;
  agent?: { name?: string; version?: string };
  checkedAt: string;
}

/** Backend-agnostic ACP session; transport details stay inside the driver. */
export interface AcpSession {
  readonly driverId: string;
  readonly nodeId: string;
  request(method: string, params?: unknown): Promise<unknown>;
  close(): void;
}

/**
 * ACP driver contract. v1 minimal surface extracted from the verified goose
 * path; extend only when a second real backend joins (avoid speculative shape).
 */
export interface AcpDriver {
  readonly id: string;
  readonly displayName: string;
  capabilities(): DriverCapabilities;
  connect(node: FleetNode): AcpSession;
  healthCheck(node: FleetNode): Promise<HealthReport>;
  /** Optional: launch the node locally (goose: spawn `goose serve`). */
  provision?(node: FleetNode): Promise<void>;
}
