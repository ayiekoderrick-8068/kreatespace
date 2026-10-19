import { zodResolver } from "@hookform/resolvers/zod";
import {
  buildQuoteMessage,
  buildWhatsAppLink,
  quoteRequestSchema,
  type QuoteRequest,
  type QuoteRequestInput,
} from "@kreatespace/shared";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { FormMessage, PrimaryButton, SecondaryButton, TextAreaField, TextField } from "./forms";

/**
 * An optional form for services that need a tailored quote (photography, event decoration).
 * It only prepares a WhatsApp message for the customer to review and send themselves. The
 * details are never sent to or stored by KreateSpace.
 */
export function QuoteRequestForm({
  businessName,
  whatsappNumber,
  subject,
  defaultServiceType = "",
  pageUrl,
  onOpen,
}: {
  businessName: string;
  whatsappNumber: string;
  /** What the quote relates to, for example the creation or package being viewed. */
  subject?: string;
  defaultServiceType?: string;
  pageUrl?: string;
  /** Called when the customer opens WhatsApp (used for click analytics). */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<QuoteRequestInput, unknown, QuoteRequest>({
    resolver: zodResolver(quoteRequestSchema),
    defaultValues: {
      serviceType: defaultServiceType,
      eventDate: "",
      eventLocation: "",
      description: "",
      customerName: "",
    },
  });

  const submit = handleSubmit((quote) => {
    const url = buildWhatsAppLink(
      whatsappNumber,
      buildQuoteMessage({ businessName, subject, quote, pageUrl }),
    );
    if (!url) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setLink(url);
    onOpen?.();
    // Opens WhatsApp with the message ready; the customer decides whether to send it.
    window.open(url, "_blank", "noopener,noreferrer");
  });

  if (!open) {
    return (
      <SecondaryButton type="button" aria-expanded={false} onClick={() => setOpen(true)}>
        Request a quote
      </SecondaryButton>
    );
  }

  return (
    <section aria-labelledby="quote-heading" className="rounded-xl border border-sand bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 id="quote-heading" className="text-lg font-semibold">
          Request a quote
        </h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm font-medium text-ink-muted underline"
        >
          Close
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Tell {businessName} what you need. We’ll prepare a WhatsApp message for you to check and
        send yourself. KreateSpace doesn’t keep these details.
      </p>

      <form onSubmit={submit} noValidate className="mt-4 space-y-4" aria-label="Quote request">
        {failed ? (
          <FormMessage kind="error">
            This business’s WhatsApp number isn’t available, so we can’t prepare a message.
          </FormMessage>
        ) : null}
        <TextField
          label="Service needed"
          required
          placeholder="e.g. Wedding photography"
          error={errors.serviceType?.message}
          {...register("serviceType")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Event date"
            optional
            type="date"
            error={errors.eventDate?.message}
            {...register("eventDate")}
          />
          <TextField
            label="Event location"
            required
            placeholder="e.g. Karen, Nairobi"
            error={errors.eventLocation?.message}
            {...register("eventLocation")}
          />
        </div>
        <TextAreaField
          label="A few details"
          required
          rows={3}
          hint="Guest numbers, style, anything that helps them quote accurately."
          error={errors.description?.message}
          {...register("description")}
        />
        <TextField
          label="Your name"
          optional
          autoComplete="name"
          error={errors.customerName?.message}
          {...register("customerName")}
        />
        <PrimaryButton type="submit">Continue in WhatsApp</PrimaryButton>
      </form>

      {link ? (
        <div className="mt-4">
          <FormMessage kind="success">
            WhatsApp should open with your message ready. Check it and press send when you’re happy.
          </FormMessage>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-sm font-medium text-terracotta underline"
          >
            WhatsApp didn’t open? Open it here
          </a>
        </div>
      ) : null}
    </section>
  );
}
