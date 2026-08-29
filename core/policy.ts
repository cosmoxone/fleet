import type { FleetNode } from './node';

/**
 * Scheduling policy: which node serves a request. v1 ships static binding only
 * (per-window bound node id); affinity/failover/load-aware policies are future work.
 */
export interface SchedulingPolicy {
  selectNode(boundNodeId: string | null, nodes: readonly FleetNode[]): FleetNode | null;
}

export const staticBindingPolicy: SchedulingPolicy = {
  selectNode(boundNodeId, nodes) {
    if (!boundNodeId) return null;
    return nodes.find((n) => n.id === boundNodeId) ?? null;
  },
};
