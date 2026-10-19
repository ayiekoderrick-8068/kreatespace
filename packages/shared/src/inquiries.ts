import { z } from "zod";

/** Categories where customers often want a tailored quote rather than a ready-made item. */
export const QUOTE_CATEGORY_SLUGS = ["photography", "event-decor"] as const;

export function supportsQuoteRequests(categorySlug: string): boolean {
  return (QUOTE_CATEGORY_SLUGS as readonly string[]).includes(categorySlug);
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * The optional quote form. These details only ever travel inside a WhatsApp message the
 * customer reviews and sends themselves; KreateSpace does not store them.
 */
export const quoteRequestSchema = z.object({
  serviceType: z
    .string()
    .trim()
    .min(2, "Say what service you need")
    .max(60, "Keep the service name under 60 characters"),
  /** Optional, as a `YYYY-MM-DD` date. */
  eventDate: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value), "Enter a valid date")
    .refine((value) => value === "" || value >= todayIso(), "The event date can’t be in the past")
    .optional(),
  eventLocation: z
    .string()
    .trim()
    .min(2, "Tell the business where the event is")
    .max(100, "Keep the location under 100 characters"),
  description: z
    .string()
    .trim()
    .min(10, "Add a few details (at least 10 characters)")
    .max(500, "Keep the details under 500 characters"),
  customerName: z.string().trim().max(60, "Keep your name under 60 characters").optional(),
});

export type QuoteRequestInput = z.input<typeof quoteRequestSchema>;
export type QuoteRequest = z.output<typeof quoteRequestSchema>;

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The message a customer reviews in WhatsApp before sending. Lines are left out when empty. */
export function buildQuoteMessage(input: {
  businessName: string;
  /** What the quote relates to, such as a creation or package title. */
  subject?: string;
  quote: QuoteRequest;
  pageUrl?: string;
}): string {
  const { businessName, subject, quote, pageUrl } = input;
  const lines = [
    `Hello ${businessName}! I found you on KreateSpace and I'd like a quote for ${quote.serviceType}.`,
    subject ? `I was looking at: ${subject}` : null,
    quote.eventDate ? `Event date: ${formatDate(quote.eventDate)}` : null,
    `Location: ${quote.eventLocation}`,
    `Details: ${quote.description}`,
    quote.customerName ? `Thank you, ${quote.customerName}` : null,
    pageUrl ?? null,
  ];
  return lines.filter(Boolean).join("\n");
}

// --- inquiry analytics -------------------------------------------------------------------------

export const INQUIRY_EVENT_TYPES = [
  "CREATION_VIEW",
  "BUSINESS_VIEW",
  "WHATSAPP_CLICK",
  "WEBSITE_CLICK",
] as const;
export type InquiryEventType = (typeof INQUIRY_EVENT_TYPES)[number];

export const INQUIRY_SOURCES = ["creation_page", "business_page", "package", "quote"] as const;

/**
 * A privacy-conscious analytics event. It names what was viewed or clicked and nothing about
 * the person: no message text, contact details, IP address or account. A click records that a
 * link was opened, not that a WhatsApp message was sent.
 */
export const inquiryEventSchema = z
  .object({
    type: z.enum(INQUIRY_EVENT_TYPES),
    businessSlug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(60)
      .optional(),
    creationId: z.uuid().optional(),
    packageId: z.uuid().optional(),
    source: z.enum(INQUIRY_SOURCES).optional(),
  })
  .superRefine((event, ctx) => {
    const need = (field: "businessSlug" | "creationId") => {
      if (!event[field]) {
        ctx.addIssue({ code: "custom", path: [field], message: `${field} is required` });
      }
    };
    if (event.type === "CREATION_VIEW") need("creationId");
    if (event.type === "BUSINESS_VIEW") need("businessSlug");
    if (event.type === "WHATSAPP_CLICK" || event.type === "WEBSITE_CLICK") {
      if (!event.businessSlug && !event.creationId) need("businessSlug");
    }
  });

export type InquiryEventInput = z.infer<typeof inquiryEventSchema>;
