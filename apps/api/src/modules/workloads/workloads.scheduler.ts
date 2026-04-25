import { Prisma } from "@prisma/client";
import { db } from "../../db/client.js";
import type { NodePool } from "../nodes/nodes.types.js";
import type { WorkloadPortSpec } from "./workloads.schema.js";

export interface PlacementRequest {
  name: string;
  type: string;
  image: string;
  requestedCpu: number;
  requestedRamMb: number;
  requestedDiskGb: number;
  requiredPool: NodePool;
  ports: WorkloadPortSpec[];
  config: Prisma.InputJsonValue;
}

export interface SchedulerDiagnostics {
  requiredPool: NodePool;
  totalNodes: number;
  poolMatches: number;
  withCapacity: number;
  candidates: number;
  selectedNodeId: string | null;
  considered: Array<{
    id: string;
    pool: NodePool;
    status: string;
    maintenance: boolean;
    rejectedReason: string | null;
  }>;
}

export interface PlacementSuccess {
  placed: true;
  workloadId: string;
  diagnostics: SchedulerDiagnostics;
}

export interface PlacementFailure {
  placed: false;
  reason: string;
  diagnostics: SchedulerDiagnostics;
}

export type PlacementResult = PlacementSuccess | PlacementFailure;

interface CandidateNode {
  id: string;
  pool: NodePool;
  totalCpu: number;
  totalRamMb: number;
  portRangeStart: number | null;
  portRangeEnd: number | null;
  availableCpu: number;
  availableRamMb: number;
}

export async function placeWorkload(request: PlacementRequest): Promise<PlacementResult> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('workload:placement'))`;

    const allNodes = await tx.node.findMany({
      select: {
        id: true,
        pool: true,
        status: true,
        maintenanceMode: true,
        totalCpu: true,
        totalRamMb: true,
        portRangeStart: true,
        portRangeEnd: true
      }
    });

    const considered: SchedulerDiagnostics["considered"] = [];
    const baseDiagnostics: Omit<SchedulerDiagnostics, "selectedNodeId"> = {
      requiredPool: request.requiredPool,
      totalNodes: allNodes.length,
      poolMatches: 0,
      withCapacity: 0,
      candidates: 0,
      considered
    };

    const eligible: typeof allNodes = [];
    for (const node of allNodes) {
      const pool = node.pool as NodePool;
      const entry = {
        id: node.id,
        pool,
        status: node.status,
        maintenance: node.maintenanceMode,
        rejectedReason: null as string | null
      };
      if (pool !== request.requiredPool) {
        entry.rejectedReason = `pool mismatch (got ${pool}, need ${request.requiredPool})`;
      } else if (node.status !== "healthy") {
        entry.rejectedReason = `status=${node.status}`;
      } else if (node.maintenanceMode) {
        entry.rejectedReason = "maintenance";
      } else if (node.totalCpu === null || node.totalRamMb === null) {
        entry.rejectedReason = "no reported capacity";
      } else {
        eligible.push(node);
      }
      considered.push(entry);
    }

    baseDiagnostics.poolMatches = considered.filter(
      (entry) => entry.pool === request.requiredPool
    ).length;
    baseDiagnostics.withCapacity = eligible.length;

    if (baseDiagnostics.poolMatches === 0) {
      return {
        placed: false,
        reason: `no nodes in pool=${request.requiredPool}`,
        diagnostics: { ...baseDiagnostics, selectedNodeId: null }
      };
    }

    if (eligible.length === 0) {
      return {
        placed: false,
        reason: `no healthy nodes with capacity in pool=${request.requiredPool}`,
        diagnostics: { ...baseDiagnostics, selectedNodeId: null }
      };
    }

    const commitments = await tx.workload.groupBy({
      by: ["nodeId"],
      where: { nodeId: { in: eligible.map((n) => n.id) }, deletedAt: null },
      _sum: { requestedCpu: true, requestedRamMb: true }
    });

    const usageByNode = new Map<string, { cpu: number; ramMb: number }>();
    for (const row of commitments) {
      if (!row.nodeId) continue;
      usageByNode.set(row.nodeId, {
        cpu: row._sum.requestedCpu ?? 0,
        ramMb: row._sum.requestedRamMb ?? 0
      });
    }

    const candidates: CandidateNode[] = [];
    for (const node of eligible) {
      const used = usageByNode.get(node.id) ?? { cpu: 0, ramMb: 0 };
      const availableCpu = (node.totalCpu as number) - used.cpu;
      const availableRamMb = (node.totalRamMb as number) - used.ramMb;

      if (availableCpu < request.requestedCpu || availableRamMb < request.requestedRamMb) {
        const entry = considered.find((c) => c.id === node.id);
        if (entry) entry.rejectedReason = "insufficient cpu/ram headroom";
        continue;
      }

      candidates.push({
        id: node.id,
        pool: node.pool as NodePool,
        totalCpu: node.totalCpu as number,
        totalRamMb: node.totalRamMb as number,
        portRangeStart: node.portRangeStart,
        portRangeEnd: node.portRangeEnd,
        availableCpu,
        availableRamMb
      });
    }

    baseDiagnostics.candidates = candidates.length;

    if (candidates.length === 0) {
      return {
        placed: false,
        reason: `no node has enough cpu/ram headroom in pool=${request.requiredPool}`,
        diagnostics: { ...baseDiagnostics, selectedNodeId: null }
      };
    }

    candidates.sort((a, b) => {
      const scoreA = a.availableCpu / a.totalCpu + a.availableRamMb / a.totalRamMb;
      const scoreB = b.availableCpu / b.totalCpu + b.availableRamMb / b.totalRamMb;
      return scoreB - scoreA;
    });

    for (const candidate of candidates) {
      const allocation = await allocatePortsForNode(tx, candidate, request.ports);
      if (allocation === null) {
        const entry = considered.find((c) => c.id === candidate.id);
        if (entry) entry.rejectedReason = "no free ports in range";
        continue;
      }

      const workload = await tx.workload.create({
        data: {
          name: request.name,
          type: request.type,
          image: request.image,
          nodeId: candidate.id,
          status: "creating",
          requestedCpu: request.requestedCpu,
          requestedRamMb: request.requestedRamMb,
          requestedDiskGb: request.requestedDiskGb,
          config: request.config,
          ports:
            allocation.length > 0
              ? {
                  createMany: {
                    data: allocation.map((port) => ({
                      nodeId: candidate.id,
                      internalPort: port.internalPort,
                      externalPort: port.externalPort,
                      protocol: port.protocol
                    }))
                  }
                }
              : undefined,
          statusEvents: {
            create: {
              previousStatus: null,
              newStatus: "creating",
              reason: `placed on node ${candidate.id} (pool=${candidate.pool})`
            }
          }
        },
        select: { id: true }
      });

      return {
        placed: true,
        workloadId: workload.id,
        diagnostics: { ...baseDiagnostics, selectedNodeId: candidate.id }
      };
    }

    return {
      placed: false,
      reason: `no node has enough free ports in range in pool=${request.requiredPool}`,
      diagnostics: { ...baseDiagnostics, selectedNodeId: null }
    };
  });
}

async function allocatePortsForNode(
  tx: Prisma.TransactionClient,
  candidate: CandidateNode,
  requested: WorkloadPortSpec[]
): Promise<Array<{ internalPort: number; externalPort: number; protocol: "tcp" | "udp" }> | null> {
  if (requested.length === 0) return [];
  if (candidate.portRangeStart === null || candidate.portRangeEnd === null) return null;

  const used = await tx.workloadPort.findMany({
    where: { nodeId: candidate.id },
    select: { externalPort: true, protocol: true }
  });

  const usedByProtocol = {
    tcp: new Set<number>(),
    udp: new Set<number>()
  };
  for (const row of used) {
    const proto = row.protocol === "udp" ? "udp" : "tcp";
    usedByProtocol[proto].add(row.externalPort);
  }

  const allocated: Array<{ internalPort: number; externalPort: number; protocol: "tcp" | "udp" }> = [];

  for (const port of requested) {
    const proto = port.protocol ?? "tcp";
    let picked: number | null = null;
    for (let p = candidate.portRangeStart; p <= candidate.portRangeEnd; p++) {
      if (usedByProtocol[proto].has(p)) continue;
      picked = p;
      break;
    }
    if (picked === null) return null;

    usedByProtocol[proto].add(picked);
    allocated.push({ internalPort: port.internalPort, externalPort: picked, protocol: proto });
  }

  return allocated;
}
