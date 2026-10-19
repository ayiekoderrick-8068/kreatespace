import type { BusinessStatus, ReviewAction, RevisionStatus } from "@kreatespace/shared";
import type { MediaStorage } from "../storage/media-storage.js";

export interface RevisionRecord {
  id: string;
  version: number;
  status: RevisionStatus;
  businessName: string;
  ownerName: string;
  description: string;
  categoryId: string;
  category: { id: string; slug: string; name: string };
  county: string;
  city: string;
  websiteUrl: string | null;
  whatsappNumber: string;
  logoPath: string | null;
  termsAcceptedAt: Date | null;
  contentAuthorizedAt: Date | null;
  submittedAt: Date | null;
  createdAt: Date;
  images: { path: string; position: number }[];
}

export interface RevisionView {
  id: string;
  version: number;
  status: RevisionStatus;
  businessName: string;
  ownerName: string;
  description: string;
  category: { id: string; slug: string; name: string };
  county: string;
  city: string;
  websiteUrl: string | null;
  whatsappNumber: string;
  logoPath: string | null;
  logoUrl: string | null;
  images: { path: string; url: string | null }[];
  termsAccepted: boolean;
  contentAuthorized: boolean;
  submittedAt: Date | null;
}

export interface DecisionView {
  id: string;
  action: ReviewAction;
  reason: string | null;
  createdAt: Date;
  revisionId: string | null;
}

export interface BusinessSummary {
  id: string;
  slug: string;
  status: BusinessStatus;
  createdAt: Date;
}

/** Builds the API representation of a revision, attaching short-lived image URLs. */
export async function toRevisionView(
  revision: RevisionRecord,
  storage: MediaStorage | undefined,
): Promise<RevisionView> {
  const images = [...revision.images].sort((a, b) => a.position - b.position);
  const paths = [...images.map((i) => i.path), ...(revision.logoPath ? [revision.logoPath] : [])];
  const urls = storage ? await storage.createReadUrls(paths) : new Map<string, string>();

  return {
    id: revision.id,
    version: revision.version,
    status: revision.status,
    businessName: revision.businessName,
    ownerName: revision.ownerName,
    description: revision.description,
    category: revision.category,
    county: revision.county,
    city: revision.city,
    websiteUrl: revision.websiteUrl,
    whatsappNumber: revision.whatsappNumber,
    logoPath: revision.logoPath,
    logoUrl: revision.logoPath ? (urls.get(revision.logoPath) ?? null) : null,
    images: images.map((image) => ({ path: image.path, url: urls.get(image.path) ?? null })),
    termsAccepted: revision.termsAcceptedAt !== null,
    contentAuthorized: revision.contentAuthorizedAt !== null,
    submittedAt: revision.submittedAt,
  };
}
