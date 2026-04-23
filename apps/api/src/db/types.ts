import type { Prisma } from "@prisma/client";

export type DbJsonInput = Prisma.InputJsonValue;
export type AdminWithRoleRecord = Prisma.AdminGetPayload<{ include: { role: true } }>;
