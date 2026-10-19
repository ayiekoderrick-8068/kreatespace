import { createClient } from "@supabase/supabase-js";
import { IMAGE_CONTENT_TYPES, IMAGE_MAX_BYTES } from "@kreatespace/shared";

/** Private object storage for business images. Unpublished images are never publicly readable. */
export interface MediaStorage {
  /** A short-lived, single-use URL the browser can upload one object to. */
  createUploadTarget(path: string): Promise<{ uploadUrl: string; token: string }>;
  /**
   * Stores bytes the server has already checked (for example an imported photo). It never
   * overwrites: uploading to a path that exists is an error.
   */
  upload(path: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Short-lived read URLs for the given paths. Missing objects are omitted from the map. */
  createReadUrls(paths: string[]): Promise<Map<string, string>>;
  /** Names of objects stored under a folder prefix (without the prefix). */
  listFolder(prefix: string): Promise<string[]>;
  /** Objects under a folder prefix with their upload times, for cleaning up abandoned uploads. */
  listObjects(prefix: string): Promise<{ name: string; createdAt: Date | null }[]>;
  /** The stored bytes, or `null` when nothing was uploaded to that path. */
  download(path: string): Promise<Buffer | null>;
  /** Deletes objects. Missing objects are ignored. */
  remove(paths: string[]): Promise<void>;
  /**
   * Optional: resized renditions for responsive images. Storage that cannot transform images
   * leaves this out and callers fall back to the original.
   */
  createVariantUrls?(
    paths: string[],
    widths: number[],
  ): Promise<Map<string, { width: number; url: string }[]>>;
}

export const READ_URL_TTL_SECONDS = 60 * 60;

export interface SupabaseStorageConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket: string;
  /** Needs a Supabase plan with image transformations; off by default. */
  imageTransforms?: boolean;
}

/**
 * Supabase Storage implementation. Uses the service-role key, so it must only ever run on the
 * server. The bucket is private; browsers upload through signed URLs and read via signed URLs.
 */
export function createSupabaseMediaStorage(config: SupabaseStorageConfig): MediaStorage & {
  ensureBucket(): Promise<void>;
} {
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = () => client.storage.from(config.bucket);

  return {
    async ensureBucket() {
      const { data } = await client.storage.getBucket(config.bucket);
      if (data) return;
      const { error } = await client.storage.createBucket(config.bucket, {
        public: false,
        fileSizeLimit: IMAGE_MAX_BYTES,
        allowedMimeTypes: [...IMAGE_CONTENT_TYPES],
      });
      if (error) throw new Error(`Could not create storage bucket: ${error.message}`);
    },

    async createUploadTarget(path) {
      const { data, error } = await bucket().createSignedUploadUrl(path);
      if (error || !data) throw new Error(`Could not create upload URL: ${error?.message}`);
      return { uploadUrl: data.signedUrl, token: data.token };
    },

    async upload(path, bytes, contentType) {
      const { error } = await bucket().upload(path, bytes, { contentType, upsert: false });
      if (error) throw new Error(`Could not store image: ${error.message}`);
    },

    async createReadUrls(paths) {
      const urls = new Map<string, string>();
      if (paths.length === 0) return urls;
      const { data, error } = await bucket().createSignedUrls(paths, READ_URL_TTL_SECONDS);
      if (error) throw new Error(`Could not create image URLs: ${error.message}`);
      for (const item of data ?? []) {
        if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
      }
      return urls;
    },

    ...(config.imageTransforms
      ? {
          async createVariantUrls(paths: string[], widths: number[]) {
            const variants = new Map<string, { width: number; url: string }[]>();
            await Promise.all(
              paths.map(async (path) => {
                const entries: { width: number; url: string }[] = [];
                for (const width of widths) {
                  const { data } = await bucket().createSignedUrl(path, READ_URL_TTL_SECONDS, {
                    transform: { width, quality: 75 },
                  });
                  if (data?.signedUrl) entries.push({ width, url: data.signedUrl });
                }
                variants.set(path, entries);
              }),
            );
            return variants;
          },
        }
      : {}),

    async listObjects(prefix) {
      const { data, error } = await bucket().list(prefix.replace(/\/+$/, ""), { limit: 1000 });
      if (error) throw new Error(`Could not list images: ${error.message}`);
      return (data ?? []).map((item) => ({
        name: item.name,
        createdAt: item.created_at ? new Date(item.created_at) : null,
      }));
    },

    async download(path) {
      const { data, error } = await bucket().download(path);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },

    async remove(paths) {
      if (paths.length === 0) return;
      const { error } = await bucket().remove(paths);
      if (error) throw new Error(`Could not remove images: ${error.message}`);
    },

    async listFolder(prefix) {
      const { data, error } = await bucket().list(prefix.replace(/\/+$/, ""), { limit: 1000 });
      if (error) throw new Error(`Could not list images: ${error.message}`);
      return (data ?? []).map((item) => item.name);
    },
  };
}
