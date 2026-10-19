import type { Prisma, PrismaClient } from "./generated/prisma/client.js";

type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}

/** Appends an audit record. Pass a transaction client to commit it with the change it describes. */
export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata,
    },
  });
}
