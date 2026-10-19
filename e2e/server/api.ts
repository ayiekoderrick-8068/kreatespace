import { createServer } from "node:http";
import { createApp } from "../../apps/api/src/app.ts";
import { createTokenVerifier } from "../../apps/api/src/auth/token-verifier.ts";
import { createPrismaUserStore } from "../../apps/api/src/auth/user-store.ts";
import { getPrisma } from "../../apps/api/src/lib/prisma.ts";
import type { MediaStorage } from "../../apps/api/src/storage/media-storage.ts";
import { fakePng } from "../../apps/api/src/test/fake-storage.ts";
import {
  API_PORT,
  API_URL,
  DATABASE_URL,
  IMAGE_PORT,
  IMAGE_URL,
  JWT_SECRET,
  SUPABASE_ISSUER,
  WEB_URL,
} from "../support/env.ts";

// The real Express app and the real database, with two stand-ins for Supabase:
//  - tokens are HS256 JWTs signed with a shared secret (the legacy Supabase mode), and
//  - image storage is an in-memory fake; stored paths are served as a tiny PNG.
const stored = new Set<string>();

const storage: MediaStorage = {
  async createUploadTarget(path) {
    stored.add(path);
    return { uploadUrl: `${IMAGE_URL}/upload/${path}`, token: "e2e-upload-token" };
  },
  async createReadUrls(paths) {
    return new Map(
      paths
        .filter((p) => stored.has(p))
        .map((p) => [p, `${IMAGE_URL}/image/${encodeURIComponent(p)}.png`]),
    );
  },
  async listFolder(prefix) {
    const folder = prefix.replace(/\/+$/, "") + "/";
    return [...stored].filter((p) => p.startsWith(folder)).map((p) => p.slice(folder.length));
  },
  async listObjects(prefix) {
    const folder = prefix.replace(/\/+$/, "") + "/";
    return [...stored]
      .filter((p) => p.startsWith(folder))
      .map((p) => ({ name: p.slice(folder.length), createdAt: new Date() }));
  },
  async download(path) {
    // Whatever the browser "uploaded" reads back as a valid 800x1000 PNG.
    return stored.has(path) ? fakePng(800, 1000) : null;
  },
  async remove(paths) {
    for (const path of paths) stored.delete(path);
  },
};

const prisma = getPrisma(DATABASE_URL);
const app = createApp(
  { CORS_ORIGIN: [WEB_URL] },
  {
    auth: {
      verifyToken: createTokenVerifier(new TextEncoder().encode(JWT_SECRET), {
        issuer: SUPABASE_ISSUER,
      }),
      users: createPrismaUserStore(prisma),
    },
    prisma,
    storage,
    webUrl: WEB_URL,
    rateLimiting: false,
  },
);

app.listen(API_PORT, "127.0.0.1", () => {
  console.log(`E2E API listening on ${API_URL}`);
});

// 1x1 PNG so portfolio images have something real to load.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
createServer((_req, res) => {
  res.writeHead(200, {
    "Content-Type": "image/png",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
  res.end(PNG);
}).listen(IMAGE_PORT, "127.0.0.1");
