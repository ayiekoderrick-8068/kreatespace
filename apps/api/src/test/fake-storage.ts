import type { MediaStorage } from "../storage/media-storage.js";

/** Smallest valid-looking PNG header for a given size (enough for dimension checks). */
export function fakePng(width = 800, height = 1000): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header[24] = 8; // bit depth
  header[25] = 2; // colour type (RGB)
  return header;
}

/** A JPEG with a start-of-frame segment carrying the given size. */
export function fakeJpeg(width = 800, height = 1000): Buffer {
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02]),
    sof,
    Buffer.from([0xff, 0xd9]),
  ]);
}

/**
 * In-memory storage for tests. `files` holds the paths that have been "uploaded"; `blobs`
 * optionally holds their bytes (anything uploaded without bytes reads back as an 800x1000 PNG).
 */
export function createFakeStorage() {
  const files = new Set<string>();
  const blobs = new Map<string, Buffer>();
  const ages = new Map<string, Date>();

  const storage: MediaStorage = {
    async createUploadTarget(path) {
      return { uploadUrl: `https://storage.test/upload/${path}`, token: "upload-token" };
    },
    async upload(path, bytes) {
      if (files.has(path)) throw new Error("already exists");
      files.add(path);
      blobs.set(path, bytes);
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
    async listObjects(prefix) {
      const normalized = prefix.replace(/\/+$/, "") + "/";
      return [...files]
        .filter((p) => p.startsWith(normalized) && !p.slice(normalized.length).includes("/"))
        .map((p) => ({ name: p.slice(normalized.length), createdAt: ages.get(p) ?? new Date() }));
    },
    async download(path) {
      if (!files.has(path)) return null;
      return blobs.get(path) ?? fakePng();
    },
    async remove(paths) {
      for (const path of paths) {
        files.delete(path);
        blobs.delete(path);
        ages.delete(path);
      }
    },
  };

  /** Simulates the browser finishing an upload. */
  function put(path: string, bytes?: Buffer, uploadedAt?: Date) {
    files.add(path);
    if (bytes) blobs.set(path, bytes);
    if (uploadedAt) ages.set(path, uploadedAt);
  }

  return { storage, files, blobs, put };
}
