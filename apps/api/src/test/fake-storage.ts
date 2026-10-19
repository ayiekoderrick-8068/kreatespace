import type { MediaStorage } from "../storage/media-storage.js";

/** In-memory storage for tests. `files` holds the paths that have been "uploaded". */
export function createFakeStorage() {
  const files = new Set<string>();

  const storage: MediaStorage = {
    async createUploadTarget(path) {
      return { uploadUrl: `https://storage.test/upload/${path}`, token: "upload-token" };
    },
    async createReadUrls(paths) {
      return new Map(
        paths.filter((p) => files.has(p)).map((p) => [p, `https://storage.test/read/${p}`]),
      );
    },
    async listFolder(prefix) {
      const normalized = prefix.replace(/\/+$/, "") + "/";
      return [...files]
        .filter((p) => p.startsWith(normalized))
        .map((p) => p.slice(normalized.length));
    },
  };

  return { storage, files };
}
