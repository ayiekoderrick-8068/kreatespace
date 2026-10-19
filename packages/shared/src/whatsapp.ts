import { normalizePhoneNumber, toWhatsAppNumber } from "./phone.js";

/** Keeps click-to-chat links comfortably within what browsers and WhatsApp accept. */
export const MAX_WHATSAPP_MESSAGE_LENGTH = 1200;

/** Removes control characters (other than line breaks) that have no place in a chat message. */
function clean(text: string): string {
  let result = "";
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const isControl = (code < 0x20 && code !== 0x0a) || code === 0x7f;
    if (!isControl) result += char;
  }
  return result.trim();
}

function clamp(message: string): string {
  const text = clean(message);
  return text.length <= MAX_WHATSAPP_MESSAGE_LENGTH
    ? text
    : `${text.slice(0, MAX_WHATSAPP_MESSAGE_LENGTH - 1).trimEnd()}…`;
}

/**
 * Builds the official `wa.me` click-to-chat link for a business's own number, with a message
 * the customer can read and edit before sending. KreateSpace never sends anything itself.
 * Returns `null` when the number is not valid, so callers can hide the action.
 */
export function buildWhatsAppLink(phone: string, message: string): string | null {
  const e164 = normalizePhoneNumber(phone);
  if (!e164) return null;
  return `https://wa.me/${toWhatsAppNumber(e164)}?text=${encodeURIComponent(clamp(message))}`;
}

/** Message for enquiring about one creation; includes a link so the seller sees which one. */
export function creationInquiryMessage(
  businessName: string,
  title: string,
  creationUrl?: string,
): string {
  const message = `Hello ${clean(businessName)}! I found your ${clean(title)} on KreateSpace. I'm interested in it. Could you please share the price, availability, and ordering details?`;
  return creationUrl ? `${message}\n${creationUrl}` : message;
}

/** Message for enquiring about one of a business's service packages. */
export function packageInquiryMessage(
  businessName: string,
  packageName: string,
  pageUrl?: string,
): string {
  const message = `Hello ${clean(businessName)}! I found your ${clean(packageName)} on KreateSpace. I'm interested in it. Could you please share the price, availability, and what's included?`;
  return pageUrl ? `${message}\n${pageUrl}` : message;
}

/** Default message for contacting a business from its profile page. */
export function profileInquiryMessage(businessName: string): string {
  return `Hello ${clean(businessName)}! I found your business on KreateSpace and I'd like to know more about your work. Could you share pricing and availability?`;
}
