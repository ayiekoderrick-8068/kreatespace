import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  WEBSITE_REQUEST_BUDGETS,
  WEBSITE_REQUEST_BUDGET_LABELS,
  WEBSITE_REQUEST_TIMELINES,
  WEBSITE_REQUEST_TIMELINE_LABELS,
  WEBSITE_REQUEST_TYPES,
  WEBSITE_REQUEST_TYPE_LABELS,
  websiteRequestSchema,
  type WebsiteRequestStatus,
  type WebsiteRequestType,
} from "@kreatespace/shared";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import {
  FormMessage,
  PrimaryButton,
  SecondaryButton,
  SelectField,
  TextAreaField,
} from "../../components/forms";
import { StatusBadge } from "../../components/StatusBadge";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/queries";

interface WebsiteRequestView {
  id: string;
  type: WebsiteRequestType;
  description: string;
  budget: string | null;
  timeline: string | null;
  status: WebsiteRequestStatus;
  responseNote: string | null;
  cancellable: boolean;
  createdAt: string;
}

interface FormValues {
  type: string;
  description: string;
  budget: string;
  timeline: string;
}

const dateFormat = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium" });
const KEY = ["seller", "website-requests"] as const;

const message = (error: unknown) =>
  error instanceof ApiError || error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

const STATUS_HELP: Partial<Record<WebsiteRequestStatus, string>> = {
  NEW: "We’ve received your request and will reply here.",
  IN_REVIEW: "Our team is looking at your request.",
  QUOTED: "We’ve sent a quote. See the reply below.",
  ACCEPTED: "You’ve agreed to go ahead. We’ll be in touch.",
  DECLINED: "We weren’t able to take this request on.",
  COMPLETED: "This request is complete.",
  CANCELLED: "You withdrew this request.",
};

function RequestForm({ onSent }: { onSent: () => void }) {
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { type: "", description: "", budget: "", timeline: "" },
  });

  const send = handleSubmit(async (values) => {
    setError(null);
    const parsed = websiteRequestSchema.safeParse({
      type: values.type || undefined,
      description: values.description,
      budget: values.budget || null,
      timeline: values.timeline || null,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]) as keyof FormValues;
        if (field in values) setFieldError(field, { message: issue.message });
      }
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/website-requests", parsed.data);
      onSent();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  });

  return (
    <form
      onSubmit={send}
      noValidate
      aria-label="Website request"
      className="space-y-4 rounded-xl border border-sand bg-white p-5"
    >
      <h2 className="text-lg font-semibold">Ask for help with a website</h2>
      <p className="text-sm text-ink-muted">
        Tell us what you need. Our team will reply here with next steps. You can have one open
        request at a time.
      </p>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <SelectField
        label="What do you need?"
        required
        placeholder="Choose one"
        options={WEBSITE_REQUEST_TYPES.map((value) => ({
          value,
          label: WEBSITE_REQUEST_TYPE_LABELS[value],
        }))}
        error={errors.type?.message}
        {...register("type")}
      />
      <TextAreaField
        label="Tell us about your business and what you’d like"
        required
        rows={5}
        hint="For example: what you sell, who your customers are, and any websites you like."
        error={errors.description?.message}
        {...register("description")}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Budget"
          optional
          placeholder="Not sure yet"
          options={WEBSITE_REQUEST_BUDGETS.map((value) => ({
            value,
            label: WEBSITE_REQUEST_BUDGET_LABELS[value],
          }))}
          error={errors.budget?.message}
          {...register("budget")}
        />
        <SelectField
          label="When do you need it?"
          optional
          placeholder="I’m flexible"
          options={WEBSITE_REQUEST_TIMELINES.map((value) => ({
            value,
            label: WEBSITE_REQUEST_TIMELINE_LABELS[value],
          }))}
          error={errors.timeline?.message}
          {...register("timeline")}
        />
      </div>
      <PrimaryButton type="submit" disabled={busy} className="w-auto">
        {busy ? "Sending…" : "Send request"}
      </PrimaryButton>
    </form>
  );
}

/** A seller's website development requests: send one, follow its progress, or withdraw it. */
export function WebsiteRequestPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: KEY,
    queryFn: () =>
      api.get<{ requests: WebsiteRequestView[]; canRequest: boolean }>("/api/website-requests"),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: KEY });
  }

  async function withdraw(id: string) {
    setError(null);
    try {
      await api.post(`/api/website-requests/${id}/cancel`);
      setConfirming(null);
      setNotice("Your request was withdrawn.");
      await refresh();
    } catch (failure) {
      setError(message(failure));
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link to="/seller" className="text-sm font-medium text-terracotta underline">
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Website help</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Need a website, or want to improve the one you have? Send us a request and we’ll reply here.
      </p>

      {notice ? (
        <div className="mt-4">
          <FormMessage kind="success">{notice}</FormMessage>
        </div>
      ) : null}
      {error ? (
        <div className="mt-4">
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      ) : null}

      {list.isPending ? (
        <p role="status" className="mt-6">
          Loading…
        </p>
      ) : list.isError ? (
        <div className="mt-6 space-y-3">
          <FormMessage kind="error">We couldn’t load your requests. Please try again.</FormMessage>
          <SecondaryButton type="button" onClick={() => void list.refetch()}>
            Try again
          </SecondaryButton>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {list.data.canRequest ? (
            <RequestForm
              onSent={() => {
                setNotice("Your request was sent. We’ll reply here.");
                void refresh();
              }}
            />
          ) : (
            <FormMessage kind="info">
              You have an open request, so you can’t send another until it’s finished or withdrawn.
            </FormMessage>
          )}

          {list.data.requests.length > 0 ? (
            <ul className="space-y-4" aria-label="Your requests">
              {list.data.requests.map((request) => (
                <li key={request.id} className="rounded-xl border border-sand bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold">{WEBSITE_REQUEST_TYPE_LABELS[request.type]}</h2>
                    <StatusBadge status={request.status} />
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    Sent {dateFormat.format(new Date(request.createdAt))}
                    {request.budget
                      ? ` · Budget: ${WEBSITE_REQUEST_BUDGET_LABELS[request.budget as keyof typeof WEBSITE_REQUEST_BUDGET_LABELS] ?? request.budget}`
                      : ""}
                  </p>
                  <p className="mt-2 whitespace-pre-line text-sm">{request.description}</p>
                  {STATUS_HELP[request.status] ? (
                    <p className="mt-2 text-sm text-ink-muted">{STATUS_HELP[request.status]}</p>
                  ) : null}
                  {request.responseNote ? (
                    <blockquote className="mt-3 rounded-md border-l-4 border-terracotta bg-cream p-3 text-sm">
                      <p className="font-medium">Reply from our team</p>
                      <p className="mt-1 whitespace-pre-line">{request.responseNote}</p>
                    </blockquote>
                  ) : null}
                  {request.cancellable ? (
                    <div className="mt-3 text-sm">
                      {confirming === request.id ? (
                        <span className="flex flex-wrap gap-4">
                          <button
                            type="button"
                            className="font-medium text-red-700 underline"
                            onClick={() => void withdraw(request.id)}
                          >
                            Yes, withdraw it
                          </button>
                          <button
                            type="button"
                            className="font-medium underline"
                            onClick={() => setConfirming(null)}
                          >
                            Keep it
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="font-medium text-red-700 underline"
                          onClick={() => setConfirming(request.id)}
                        >
                          Withdraw request
                        </button>
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </main>
  );
}
