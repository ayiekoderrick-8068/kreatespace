import type {
  BusinessStatus,
  InvitationStatus,
  RevisionStatus,
  UserRole,
} from "@kreatespace/shared";

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
}

export interface RevisionView {
  id: string;
  version: number;
  status: RevisionStatus;
  businessName: string;
  ownerName: string;
  description: string;
  category: Category;
  county: string;
  city: string;
  websiteUrl: string | null;
  whatsappNumber: string;
  logoPath: string | null;
  logoUrl: string | null;
  images: { path: string; url: string | null }[];
  termsAccepted: boolean;
  contentAuthorized: boolean;
  submittedAt: string | null;
}

export interface DecisionView {
  id: string;
  action: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED" | "SUSPENDED" | "REINSTATED";
  reason: string | null;
  createdAt: string;
  revisionId: string | null;
}

export interface OwnBusiness {
  business: { id: string; slug: string; status: BusinessStatus; createdAt: string };
  revision: RevisionView;
  publishedRevision: RevisionView | null;
  decisions: DecisionView[];
}

export interface Invitation {
  id: string;
  email: string;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface AdminBusinessListItem {
  id: string;
  slug: string;
  status: BusinessStatus;
  businessName: string;
  ownerName: string;
  ownerEmail: string;
  categoryName: string;
  county: string;
  city: string;
  hasPendingSubmission: boolean;
  pendingSubmittedAt: string | null;
  updatedAt: string;
}

export interface AdminBusinessList {
  items: AdminBusinessListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminBusinessDetail {
  business: {
    id: string;
    slug: string;
    status: BusinessStatus;
    createdAt: string;
    owner: { id: string; email: string; fullName: string | null };
  };
  reviewRevision: RevisionView;
  publishedRevision: RevisionView | null;
  revisions: { id: string; version: number; status: RevisionStatus; submittedAt: string | null }[];
  decisions: (DecisionView & {
    admin: { id: string; email: string; fullName: string | null };
  })[];
}

export interface ImageView {
  url: string | null;
  srcSet: string | null;
  width: number;
  height: number;
}

export interface CreationCard {
  id: string;
  title: string;
  image: ImageView | null;
  category: { slug: string; name: string };
  occasion: { slug: string; name: string } | null;
  business: { slug: string; name: string; county: string; city: string };
  publishedAt: string | null;
}

export interface CreationPage {
  items: CreationCard[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface CreationDetail {
  id: string;
  title: string;
  description: string;
  category: { slug: string; name: string };
  occasion: { slug: string; name: string } | null;
  images: ImageView[];
  publishedAt: string | null;
  business: {
    slug: string;
    name: string;
    county: string;
    city: string;
    logoUrl: string | null;
    websiteUrl: string | null;
    whatsappNumber: string;
  };
}

export interface HomeData {
  categories: { slug: string; name: string; count: number; cover: ImageView | null }[];
  recent: CreationCard[];
  businesses: {
    slug: string;
    name: string;
    county: string;
    city: string;
    categoryName: string;
    logoUrl: string | null;
    creationCount: number;
    previews: ImageView[];
  }[];
}

export interface FilterOptions {
  categories: { slug: string; name: string }[];
  occasions: { slug: string; name: string }[];
}

export interface PublicBusiness {
  slug: string;
  businessName: string;
  description: string;
  categories: { slug: string; name: string }[];
  category: { slug: string; name: string };
  county: string;
  city: string;
  websiteUrl: string | null;
  whatsappNumber: string;
  logoUrl: string | null;
  images: { url: string }[];
  creations: CreationCard[];
  hasMoreCreations: boolean;
  packages: PublicPackage[];
}

// --- seller portfolio -------------------------------------------------------------------------

export type CreationStatus =
  "DRAFT" | "PENDING" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED" | "SUSPENDED" | "ARCHIVED";

export interface Usage {
  used: number;
  limit: number;
  remaining: number;
  byStatus: Partial<Record<CreationStatus, number>>;
}

export interface CreationSummary {
  id: string;
  status: CreationStatus;
  title: string;
  category: { slug: string; name: string };
  revisionStatus: string;
  hasPublishedVersion: boolean;
  imageCount: number;
  cover: { url: string | null; width: number; height: number } | null;
  updatedAt: string;
  latestFeedback: { action: string; reason: string | null } | null;
}

export interface SellerImage {
  id: string;
  position: number;
  width: number;
  height: number;
  url: string | null;
}

export interface SellerRevision {
  id: string;
  version: number;
  status: RevisionStatus;
  title: string;
  description: string;
  category: Category;
  occasion: Category | null;
  submittedAt: string | null;
  images: SellerImage[];
}

export interface OwnCreation {
  creation: {
    id: string;
    status: CreationStatus;
    createdAt: string;
    updatedAt: string;
    editable: boolean;
    canStartRevision: boolean;
  };
  revision: SellerRevision;
  publishedRevision: SellerRevision | null;
  decisions: DecisionView[];
}

export interface OccasionOption {
  id: string;
  slug: string;
  name: string;
}

export interface AdminCreationListItem {
  id: string;
  status: CreationStatus;
  title: string;
  categoryName: string;
  businessId: string;
  businessName: string;
  businessSlug: string;
  hasPendingSubmission: boolean;
  pendingSubmittedAt: string | null;
  updatedAt: string;
}

export interface AdminCreationDetail {
  creation: { id: string; status: CreationStatus; createdAt: string; publishedAt: string | null };
  business: { id: string; slug: string; name: string; status: string };
  reviewRevision: SellerRevision;
  publishedRevision: SellerRevision | null;
  revisions: { id: string; version: number; status: RevisionStatus; submittedAt: string | null }[];
  decisions: (DecisionView & { admin: { id: string; email: string; fullName: string | null } })[];
}

// --- service packages -------------------------------------------------------------------------

export interface PackageView {
  name: string;
  description: string;
  includes: string[];
  startingPriceKes: number | null;
  image: ImageView | null;
}

export interface OwnPackage {
  id: string;
  status: "ACTIVE" | "ARCHIVED" | "SUSPENDED";
  reviewState: RevisionStatus;
  editable: boolean;
  hasPublishedVersion: boolean;
  draft: PackageView;
  published: PackageView | null;
  latestFeedback: { action: string; reason: string | null } | null;
  updatedAt: string;
}

export interface AdminPackageListItem {
  id: string;
  name: string;
  status: string;
  reviewState: RevisionStatus;
  businessId: string;
  businessName: string;
  submittedAt: string | null;
  updatedAt: string;
}

export interface AdminPackageDetail {
  package: {
    id: string;
    status: string;
    reviewState: RevisionStatus;
    submittedAt: string | null;
    publishedAt: string | null;
  };
  business: { id: string; slug: string; name: string; status: string };
  draft: PackageView;
  published: PackageView | null;
  decisions: {
    id: string;
    action: string;
    reason: string | null;
    createdAt: string;
    admin: { id: string; email: string; fullName: string | null };
  }[];
}

export interface PublicPackage extends PackageView {
  id: string;
}
