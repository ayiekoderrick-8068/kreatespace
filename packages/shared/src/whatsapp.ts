import { normalizeKenyanPhone, toWhatsAppNumber } from "./phone.js";

/**
 * Builds a `wa.me` link that opens a chat with the business and pre-fills (but never sends)
 * a message the customer can review first. Returns `null` when the number is not valid.
 */
export function buildWhatsAppLink(phone: string, message: string): string | null {
  const e164 = normalizeKenyanPhone(phone);
  if (!e164) return null;
  return `https://wa.me/${toWhatsAppNumber(e164)}?text=${encodeURIComponent(message)}`;
}

/** Message for enquiring about one creation; includes a link so the seller sees which one. */
export function creationInquiryMessage(
  businessName: string,
  title: string,
  creationUrl?: string,
): string {
  const message = `Hello ${businessName}! I found your ${title} on KreateSpace. I'm interested in ordering it. Could you share pricing and availability?`;
  return creationUrl ? `${message}\n${creationUrl}` : message;
}

/** Default message for contacting a business from its profile page. */
export function profileInquiryMessage(businessName: string): string {
  return `Hello ${businessName}! I found your business on KreateSpace and I'd like to know more about your work. Could you share pricing and availability?`;
}
