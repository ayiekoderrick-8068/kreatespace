import { IMAGE_CONTENT_TYPES, IMAGE_MAX_BYTES, type UploadRequest } from "@kreatespace/shared";
import { getSupabase } from "./supabase";

const BUCKET = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET ?? "business-media";

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

/** Sends a file to a signed upload URL issued by the API. */
export async function uploadToStorage(path: string, token: string, file: File): Promise<void> {
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
