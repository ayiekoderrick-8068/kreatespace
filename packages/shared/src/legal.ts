/**
 * Facts the legal documents state about how the service behaves. They live here, next to the code
 * that enforces them, so the policy text and the software cannot quietly drift apart.
 */

/** Which version of the legal documents a person agreed to. Raise it whenever the text changes. */
export const LEGAL_VERSION = "draft-0.1";

/** How long a deletion request waits before it is carried out, so it can be cancelled. */
export const DELETION_GRACE_DAYS = 14;

/** Anonymous analytics events (no personal data) are removed after this long. */
export const ANALYTICS_RETENTION_MONTHS = 13;

/** Invitations expire after this many days. */
export const INVITATION_VALID_DAYS = 14;

/** How recently a person must have signed in to ask for their account to be deleted. */
export const RECENT_SIGN_IN_MINUTES = 10;
