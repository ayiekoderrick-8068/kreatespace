import { imageSize } from "image-size";
import { IMAGE_MAX_BYTES } from "@kreatespace/shared";
import type { IMAGE_CONTENT_TYPES } from "@kreatespace/shared";

export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

export interface InspectedImage {
  contentType: ImageContentType;
  extension: "jpg" | "png" | "webp";
  width: number;
  height: number;
}

export const IMAGE_MIN_SIDE = 200;
export const IMAGE_MAX_SIDE = 10_000;

/** Why an uploaded file was refused, in words that can be shown to the seller. */
export class InvalidImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidImageError";
  }
}

/** Identifies a file by its actual bytes, never by its name or the type the browser claimed. */
function sniff(buffer: Buffer): Pick<InspectedImage, "contentType" | "extension"> | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { contentType: "image/png", extension: "png" };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }
  return null;
}

/**
 * Checks an uploaded file: it must be a real JPEG, PNG or WebP within the size limit, with
 * sensible dimensions. Returns what was found so the dimensions can be stored.
 */
export function inspectImage(buffer: Buffer): InspectedImage {
  if (buffer.length === 0) throw new InvalidImageError("The file is empty.");
  if (buffer.length > IMAGE_MAX_BYTES) {
    throw new InvalidImageError("The image is larger than 5 MB.");
  }
  const kind = sniff(buffer);
  if (!kind) throw new InvalidImageError("Only JPEG, PNG or WebP images are allowed.");

  let width: number | undefined;
  let height: number | undefined;
  try {
    ({ width, height } = imageSize(buffer));
  } catch {
    throw new InvalidImageError("This file looks damaged and couldn’t be read as an image.");
  }
  if (!width || !height) {
    throw new InvalidImageError("This file looks damaged and couldn’t be read as an image.");
  }
  if (Math.min(width, height) < IMAGE_MIN_SIDE) {
    throw new InvalidImageError(
      `The image is too small. Use at least ${IMAGE_MIN_SIDE} pixels on each side.`,
    );
  }
  if (Math.max(width, height) > IMAGE_MAX_SIDE) {
    throw new InvalidImageError(
      `The image is too large. Use at most ${IMAGE_MAX_SIDE} pixels on each side.`,
    );
  }
  return { ...kind, width, height };
}
