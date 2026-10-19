import { IMAGE_CONTENT_TYPES, IMAGE_MAX_BYTES, type UploadRequest } from "@kreatespace/shared";

const BUCKET = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET ?? "business-media";

/** Phone photos are far larger than any screen needs; this is plenty for a full-width view. */
export const UPLOAD_MAX_SIDE = 1600;
/** Photos already this small and light are left exactly as the seller took them. */
const LEAVE_ALONE_BYTES = 1_200_000;
const JPEG_QUALITY = 0.85;
/** The API refuses images with a side shorter than this; never shrink one below it. */
const MIN_SIDE = 200;

/** Client-side check so people get quick feedback; the API and bucket enforce the same limits. */
export function validateImageFile(file: File): string | null {
  if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    return `${file.name}: only JPEG, PNG or WebP images are allowed.`;
  }
  if (file.size > IMAGE_MAX_BYTES) {
    return `${file.name}: images must be 5 MB or smaller.`;
  }
  if (file.size === 0) {
    return `${file.name}: this file is empty.`;
  }
  return null;
}

export function uploadRequestFor(file: File): UploadRequest {
  return { contentType: file.type as UploadRequest["contentType"], size: file.size };
}

/** The name with a different extension: `IMG_001.png` -> `IMG_001.jpg`. */
function renamed(name: string, type: string): string {
  const extension = type === "image/webp" ? "webp" : "jpg";
  return `${name.replace(/\.[^.]+$/, "")}.${extension}`;
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, JPEG_QUALITY));
}

/**
 * Makes a large photo lighter before it is uploaded, so pages load quickly on mobile data.
 * Photos are scaled so the longer side is at most 1600 pixels and re-saved at good quality
 * (the camera's orientation is respected). It returns the original file unchanged when the photo
 * is already small, could not be processed, would end up too thin for the API, or would not get
 * any lighter, so it can never make things worse.
 */
export async function shrinkImage(file: File): Promise<File> {
  try {
    if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(file.type)) return file;
    if (typeof createImageBitmap !== "function") return file;

    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const longest = Math.max(bitmap.width, bitmap.height);
      if (longest <= UPLOAD_MAX_SIDE && file.size <= LEAVE_ALONE_BYTES) return file;

      const scale = Math.min(1, UPLOAD_MAX_SIDE / longest);
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      if (Math.min(width, height) < MIN_SIDE) return file;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return file;
      // Transparent areas (a PNG) would turn black in a JPEG.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);

      const type = file.type === "image/webp" ? "image/webp" : "image/jpeg";
      const blob = await toBlob(canvas, type);
      if (!blob || blob.size === 0 || blob.size >= file.size) return file;
      return new File([blob], renamed(file.name, type), { type, lastModified: file.lastModified });
    } finally {
      bitmap.close?.();
    }
  } catch {
    return file;
  }
}

/**
 * Checks a chosen photo, makes it lighter if it is large, and checks the result against the
 * upload limits. Photos a little over 5 MB succeed when they can be shrunk below it.
 */
export async function prepareImage(file: File): Promise<{ file: File } | { error: string }> {
  if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(file.type) || file.size === 0) {
    return { error: validateImageFile(file)! };
  }
  const prepared = await shrinkImage(file);
  const error = validateImageFile(prepared);
  // Keep the person's own file name in the message even when the file was renamed.
  return error ? { error: error.replace(prepared.name, file.name) } : { file: prepared };
}

/** Sends a file to a signed upload URL issued by the API. */
export async function uploadToStorage(path: string, token: string, file: File): Promise<void> {
  // The sign-in library is large, so it is fetched when the first photo is sent, not before.
  const { getSupabase } = await import("./supabase");
  const supabase = getSupabase();
  if (!supabase) throw new Error("Storage is not configured");
  const { error } = await supabase.storage
    .from(BUCKET)
    .uploadToSignedUrl(path, token, file, { contentType: file.type });
  if (error) throw new Error(error.message);
}

/** A temporary local preview of a just-selected file (not available in every environment). */
export function previewUrlFor(file: File): string | null {
  return typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
}
