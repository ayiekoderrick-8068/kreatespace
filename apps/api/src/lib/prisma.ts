import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

let client: PrismaClient | undefined;

/** Returns the shared Prisma client, creating it on first use. */
export function getPrisma(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): PrismaClient {
  if (!client) {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is not set");
    }
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
