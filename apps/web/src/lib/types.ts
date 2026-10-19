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
}
