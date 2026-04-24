import { Prisma } from "@prisma/client";
import { db } from "../../db/client.js";
import type { WorkloadPortSpec } from "./workloads.schema.js";

export interface PlacementRequest {
  name: string;
  type: string;
  image: string;
  requestedCpu: number;
  requestedRamMb: number;
  requestedDiskGb: number;
  ports: WorkloadPortSpec[];
  config: Prisma.InputJsonValue;
}

export interface PlacementSuccess {
  placed: true;
  workloadId: string;
}

export interface PlacementFailure {
  placed: false;
  reason: string;
}

export type PlacementResult = PlacementSuccess | PlacementFailure;

interface CandidateNode {
  id: string;
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

    const nodes = await tx.node.findMany({
      where: { status: "healthy", maintenanceMode: false },
      select: {
        id: true,
        totalCpu: true,
        totalRamMb: true,
        portRangeStart: true,
        portRangeEnd: true
      }
    });

    if (nodes.length === 0) {
      return { placed: false, reason: "no healthy nodes available" };
    }

    const withCapacity = nodes.filter(
      (node) => node.totalCpu !== null && node.totalRamMb !== null
    );
    if (withCapacity.length === 0) {
      return { placed: false, reason: "no nodes with reported capacity" };
    }

    const commitments = await tx.workload.groupBy({
      by: ["nodeId"],
      where: { nodeId: { in: withCapacity.map((n) => n.id) }, deletedAt: null },
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
    for (const node of withCapacity) {
      const used = usageByNode.get(node.id) ?? { cpu: 0, ramMb: 0 };
      const availableCpu = (node.totalCpu as number) - used.cpu;
      const availableRamMb = (node.totalRamMb as number) - used.ramMb;

      if (availableCpu < request.requestedCpu) continue;
      if (availableRamMb < request.requestedRamMb) continue;

      candidates.push({
        id: node.id,
        totalCpu: node.totalCpu as number,
        totalRamMb: node.totalRamMb as number,
        portRangeStart: node.portRangeStart,
        portRangeEnd: node.portRangeEnd,
        availableCpu,
        availableRamMb
      });
    }

    if (candidates.length === 0) {
      return { placed: false, reason: "no node has enough cpu/ram headroom" };
    }

    candidates.sort((a, b) => {
      const scoreA = a.availableCpu / a.totalCpu + a.availableRamMb / a.totalRamMb;
      const scoreB = b.availableCpu / b.totalCpu + b.availableRamMb / b.totalRamMb;
      return scoreB - scoreA;
    });

    for (const candidate of candidates) {
      const allocation = await allocatePortsForNode(tx, candidate, request.ports);
      if (allocation === null) continue;

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
              reason: `placed on node ${candidate.id}`
            }
          }
        },
        select: { id: true }
      });

      return { placed: true, workloadId: workload.id };
    }

    return { placed: false, reason: "no node has enough free ports in range" };
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
