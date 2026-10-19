import { z } from "zod";
import { emailSchema } from "./auth.js";

export const INVITATION_STATUSES = ["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** Invitation tokens are 32 random bytes encoded as base64url (43 characters). */
export const invitationTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "This invitation link is not valid");

export const createInvitationSchema = z.object({ email: emailSchema });

export const acceptInvitationSchema = z.object({ token: invitationTokenSchema });

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
