import type { MediaStorage } from "./media-storage.js";

export interface ImageView {
  /** Largest available rendition; `null` when the image can't be served. */
  url: string | null;
  /** `srcset` value with smaller renditions, when the storage can produce them. */
  srcSet: string | null;
  /** Intrinsic size, so pages can reserve space before the image loads. */
  width: number;
  height: number;
}

export interface ImageRef {
  path: string;
  width: number;
  height: number;
}

/** Widths offered to browsers when the storage supports image transformations. */
export const IMAGE_VARIANT_WIDTHS = [480, 800, 1200] as const;

/** Development fixtures live in the web app's public folder rather than in private storage. */
const FIXTURE_PREFIX = "dev-fixtures/";

export function isFixturePath(path: string): boolean {
  return path.startsWith(FIXTURE_PREFIX) && /^[a-z0-9/_-]+\.(svg|jpg|png|webp)$/.test(path);
}

/** Resolves stored image paths to browser-ready URLs in one batch. */
export async function resolveImages(
  storage: MediaStorage | undefined,
  refs: ImageRef[],
): Promise<Map<string, ImageView>> {
  const result = new Map<string, ImageView>();
  const stored = refs.filter((ref) => !isFixturePath(ref.path));

  for (const ref of refs) {
    if (isFixturePath(ref.path)) {
      result.set(ref.path, {
        url: `/${ref.path}`,
        srcSet: null,
        width: ref.width,
        height: ref.height,
      });
    }
  }
  if (!storage || stored.length === 0) {
    for (const ref of stored) {
      result.set(ref.path, { url: null, srcSet: null, width: ref.width, height: ref.height });
    }
    return result;
  }

  const paths = stored.map((ref) => ref.path);
  const urls = await storage.createReadUrls(paths);
  const variants = storage.createVariantUrls
    ? await storage.createVariantUrls(paths, [...IMAGE_VARIANT_WIDTHS])
    : null;

  for (const ref of stored) {
    const srcSet = variants?.get(ref.path);
    result.set(ref.path, {
      url: urls.get(ref.path) ?? null,
      srcSet:
        srcSet && srcSet.length > 0 ? srcSet.map((v) => `${v.url} ${v.width}w`).join(", ") : null,
      width: ref.width,
      height: ref.height,
    });
  }
  return result;
}
