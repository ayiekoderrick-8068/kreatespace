import type { CreationStatus, ReviewAction, RevisionStatus } from "@kreatespace/shared";
import { resolveImages } from "../storage/image-urls.js";
import type { MediaStorage } from "../storage/media-storage.js";

export interface RevisionRecord {
  id: string;
  version: number;
  status: RevisionStatus;
  title: string;
  description: string;
  category: { id: string; slug: string; name: string };
  occasion: { id: string; slug: string; name: string } | null;
  submittedAt: Date | null;
  images: { id: string; path: string; position: number; width: number; height: number }[];
}

export interface SellerImageView {
  id: string;
  position: number;
  width: number;
  height: number;
  /** `null` while the file can't be served (for example before the upload finished). */
  url: string | null;
}

export interface SellerRevisionView {
  id: string;
  version: number;
  status: RevisionStatus;
  title: string;
  description: string;
  category: { id: string; slug: string; name: string };
  occasion: { id: string; slug: string; name: string } | null;
  submittedAt: Date | null;
  images: SellerImageView[];
}

export interface CreationDecisionView {
  id: string;
  action: ReviewAction;
  reason: string | null;
  createdAt: Date;
  revisionId: string | null;
}

/** Builds the owner's view of a revision, with short-lived private image URLs. */
export async function toSellerRevision(
  revision: RevisionRecord,
  storage: MediaStorage | undefined,
): Promise<SellerRevisionView> {
  const images = [...revision.images].sort((a, b) => a.position - b.position);
  const resolved = await resolveImages(storage, images);
  return {
    id: revision.id,
    version: revision.version,
    status: revision.status,
    title: revision.title,
    description: revision.description,
    category: revision.category,
    occasion: revision.occasion,
    submittedAt: revision.submittedAt,
    images: images.map((image) => ({
      id: image.id,
      position: image.position,
      width: image.width,
      height: image.height,
      url: resolved.get(image.path)?.url ?? null,
    })),
  };
}

export interface UsageView {
  used: number;
  limit: number;
  remaining: number;
  byStatus: Partial<Record<CreationStatus, number>>;
}
