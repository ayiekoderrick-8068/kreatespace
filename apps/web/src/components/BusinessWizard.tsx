import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  KENYAN_COUNTIES,
  PORTFOLIO_MAX_IMAGES,
  PORTFOLIO_MIN_IMAGES,
  agreementsSchema,
  businessDetailsSchema,
  type BusinessDetails,
  type BusinessDetailsInput,
} from "@kreatespace/shared";
import { useState, type ChangeEvent } from "react";
import { useForm } from "react-hook-form";
import { ApiError } from "../lib/api";
import { queryKeys, useApi, useCategories } from "../lib/queries";
import type { OwnBusiness } from "../lib/types";
import { previewUrlFor, uploadRequestFor, uploadToStorage, prepareImage } from "../lib/uploads";
import {
  CheckboxField,
  FormMessage,
  PrimaryButton,
  SecondaryButton,
  SelectField,
  TextAreaField,
  TextField,
} from "./forms";

type Mode = "register" | "update";

const STEPS = ["Business details", "Photos", "Review and submit"] as const;

interface Photo {
  path: string;
  url: string | null;
  name: string;
}

interface Props {
  mode: Mode;
  business: OwnBusiness | null;
  /** Called after the submission for review succeeds. */
  onSubmitted: () => void;
}

function Progress({ step }: { step: number }) {
  return (
    <nav aria-label="Progress">
      <p className="text-sm font-medium text-ink-muted">
        Step {step + 1} of {STEPS.length}
      </p>
      <ol className="mt-2 grid grid-cols-3 gap-2">
        {STEPS.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? "step" : undefined}
            className={`border-t-4 pt-2 text-xs sm:text-sm ${
              index < step
                ? "border-terracotta text-ink"
                : index === step
                  ? "border-terracotta font-semibold text-ink"
                  : "border-cream-dark text-ink-muted"
            }`}
          >
            {label}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

export function BusinessWizard({ mode, business, onSubmitted }: Props) {
  const api = useApi();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const revision = business?.revision;

  const [step, setStep] = useState(0);
  const [exists, setExists] = useState(Boolean(business));
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [logo, setLogo] = useState<Photo | null>(
    revision?.logoPath
      ? { path: revision.logoPath, url: revision.logoUrl, name: "Current logo" }
      : null,
  );
  const [portfolio, setPortfolio] = useState<Photo[]>(
    revision?.images.map((image, index) => ({
      path: image.path,
      url: image.url,
      name: `Photo ${index + 1}`,
    })) ?? [],
  );
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [agreements, setAgreements] = useState({
    termsAccepted: revision?.termsAccepted ?? false,
    contentAuthorization: revision?.contentAuthorized ?? false,
  });
  const [agreementErrors, setAgreementErrors] = useState<Record<string, string>>({});

  const {
    register,
    handleSubmit,
    setError,
    getValues,
    formState: { errors },
  } = useForm<BusinessDetailsInput, unknown, BusinessDetails>({
    resolver: zodResolver(businessDetailsSchema),
    defaultValues: {
      businessName: revision?.businessName ?? "",
      ownerName: revision?.ownerName ?? "",
      description: revision?.description ?? "",
      categoryId: revision?.category.id ?? "",
      county: (revision?.county as BusinessDetailsInput["county"]) ?? undefined,
      city: revision?.city ?? "",
      websiteUrl: revision?.websiteUrl ?? "",
      whatsappNumber: revision?.whatsappNumber ?? "",
    },
  });

  function applyServerFieldErrors(error: unknown) {
    if (error instanceof ApiError) {
      for (const [field, message] of Object.entries(error.fields)) {
        if (field in getValues()) setError(field as keyof BusinessDetailsInput, { message });
      }
    }
  }

  const saveDetails = handleSubmit(async (values) => {
    setServerError(null);
    setSaving(true);
    try {
      if (exists) await api.patch("/api/businesses/me", values);
      else {
        await api.post("/api/businesses", values);
        setExists(true);
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.ownBusiness });
      setStep(1);
    } catch (error) {
      applyServerFieldErrors(error);
      setServerError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  });

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>, target: "logo" | "portfolio") {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    const problems: string[] = [];
    const room = target === "logo" ? 1 : PORTFOLIO_MAX_IMAGES - portfolio.length;
    if (files.length > room) {
      problems.push(
        target === "logo"
          ? "Choose a single logo image."
          : `You can add up to ${PORTFOLIO_MAX_IMAGES} photos. Remove one to add another.`,
      );
    }

    setUploading(true);
    setPhotoError(null);
    for (const file of files.slice(0, Math.max(room, 0))) {
      const prepared = await prepareImage(file);
      if ("error" in prepared) {
        problems.push(prepared.error);
        continue;
      }
      try {
        const upload = await api.post<{ path: string; token: string }>(
          "/api/businesses/me/uploads",
          uploadRequestFor(prepared.file),
        );
        await uploadToStorage(upload.path, upload.token, prepared.file);
        const photo = { path: upload.path, url: previewUrlFor(prepared.file), name: file.name };
        if (target === "logo") setLogo(photo);
        else setPortfolio((current) => [...current, photo]);
      } catch (error) {
        problems.push(`${file.name}: ${errorMessage(error)}`);
      }
    }
    setUploadErrors(problems);
    setUploading(false);
  }

  async function savePhotos() {
    if (portfolio.length < PORTFOLIO_MIN_IMAGES) {
      setPhotoError("Add at least one portfolio photo to continue.");
      return;
    }
    setServerError(null);
    setSaving(true);
    try {
      await api.patch("/api/businesses/me", {
        portfolioPaths: portfolio.map((photo) => photo.path),
        logoPath: logo?.path ?? null,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.ownBusiness });
      setStep(2);
    } catch (error) {
      setServerError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    const parsed = agreementsSchema.safeParse(agreements);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setAgreementErrors(next);
      return;
    }
    setAgreementErrors({});
    setServerError(null);
    setSaving(true);
    try {
      await api.patch("/api/businesses/me", agreements);
      await api.post("/api/businesses/me/submit");
      await queryClient.invalidateQueries({ queryKey: queryKeys.ownBusiness });
      onSubmitted();
    } catch (error) {
      setServerError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  // A saved category can only be shown once the list of categories has loaded.
  if (categories.isPending) {
    return (
      <p role="status" className="text-sm text-ink-muted">
        Loading…
      </p>
    );
  }

  const values = getValues();
  const categoryName = categories.data?.find((c) => c.id === values.categoryId)?.name;

  return (
    <div className="space-y-6">
      <Progress step={step} />
      {serverError ? <FormMessage kind="error">{serverError}</FormMessage> : null}

      {step === 0 ? (
        <form onSubmit={saveDetails} noValidate className="space-y-5" aria-label="Business details">
          <p className="text-sm text-ink-muted">
            Fields marked <span className="text-terracotta">*</span> are required.
          </p>
          <TextField
            label="Business name"
            required
            autoComplete="organization"
            error={errors.businessName?.message}
            {...register("businessName")}
          />
          <TextField
            label="Business owner’s name"
            required
            autoComplete="name"
            error={errors.ownerName?.message}
            {...register("ownerName")}
          />
          <TextAreaField
            label="About your business"
            required
            hint="Tell customers what you make and what makes your work special (30–1,000 characters)."
            error={errors.description?.message}
            {...register("description")}
          />
          <SelectField
            label="Category"
            required
            placeholder="Choose a category"
            options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            error={errors.categoryId?.message}
            {...register("categoryId")}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField
              label="County"
              required
              placeholder="Choose a county"
              options={KENYAN_COUNTIES.map((county) => ({ value: county, label: county }))}
              error={errors.county?.message}
              {...register("county")}
            />
            <TextField
              label="City or town"
              required
              autoComplete="address-level2"
              error={errors.city?.message}
              {...register("city")}
            />
          </div>
          <TextField
            label="Website"
            optional
            type="url"
            inputMode="url"
            placeholder="https://"
            hint="No website? No problem — you can still join KreateSpace."
            error={errors.websiteUrl?.message}
            {...register("websiteUrl")}
          />
          <TextField
            label="WhatsApp Business number"
            required
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0712 345 678"
            hint="Customers will contact you directly on this number."
            error={errors.whatsappNumber?.message}
            {...register("whatsappNumber")}
          />
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save and continue"}
          </PrimaryButton>
        </form>
      ) : null}

      {step === 1 ? (
        <section aria-label="Photos" className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Portfolio photos</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Add {PORTFOLIO_MIN_IMAGES}–{PORTFOLIO_MAX_IMAGES} photos of your best work (JPEG, PNG
              or WebP, up to 5 MB each). Only upload images you own or are allowed to share.
            </p>
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {portfolio.map((photo, index) => (
                <li key={photo.path} className="rounded-lg border border-cream-dark bg-white p-2">
                  {photo.url ? (
                    <img
                      src={photo.url}
                      alt={`Portfolio photo ${index + 1}`}
                      className="aspect-square w-full rounded object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square items-center justify-center rounded bg-cream-dark text-sm text-ink-muted">
                      Photo {index + 1}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setPortfolio((c) => c.filter((p) => p.path !== photo.path))}
                    className="mt-2 text-sm font-medium text-red-700 underline"
                    aria-label={`Remove photo ${index + 1}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <label htmlFor="portfolio-input" className="block text-sm font-medium">
                Add photos
              </label>
              <input
                id="portfolio-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={uploading || portfolio.length >= PORTFOLIO_MAX_IMAGES}
                onChange={(event) => void uploadFiles(event, "portfolio")}
                className="mt-1 block w-full text-sm"
              />
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold">
              Logo <span className="text-sm font-normal text-ink-muted">(optional)</span>
            </h2>
            {logo ? (
              <div className="mt-3 flex items-center gap-3">
                {logo.url ? (
                  <img src={logo.url} alt="Your logo" className="h-16 w-16 rounded object-cover" />
                ) : null}
                <button
                  type="button"
                  onClick={() => setLogo(null)}
                  className="text-sm font-medium text-red-700 underline"
                >
                  Remove logo
                </button>
              </div>
            ) : null}
            <label htmlFor="logo-input" className="mt-3 block text-sm font-medium">
              {logo ? "Replace logo" : "Add logo"}
            </label>
            <input
              id="logo-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading}
              onChange={(event) => void uploadFiles(event, "logo")}
              className="mt-1 block w-full text-sm"
            />
          </div>

          <div aria-live="polite">
            {uploading ? <FormMessage kind="info">Uploading…</FormMessage> : null}
            {uploadErrors.length > 0 ? (
              <ul className="space-y-1 text-sm text-red-700">
                {uploadErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : null}
            {photoError ? <FormMessage kind="error">{photoError}</FormMessage> : null}
          </div>

          <div className="flex gap-3">
            <SecondaryButton type="button" onClick={() => setStep(0)}>
              Back
            </SecondaryButton>
            <PrimaryButton
              type="button"
              className="flex-1"
              disabled={saving || uploading}
              onClick={() => void savePhotos()}
            >
              {saving ? "Saving…" : "Save and continue"}
            </PrimaryButton>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section aria-label="Review and submit" className="space-y-6">
          <div className="rounded-xl border border-cream-dark bg-white p-5">
            <h2 className="text-lg font-semibold">{values.businessName}</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="font-medium">Category</dt>
                <dd className="text-ink-muted">{categoryName ?? "—"}</dd>
              </div>
              <div>
                <dt className="font-medium">Location</dt>
                <dd className="text-ink-muted">
                  {values.city}, {values.county}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Website</dt>
                <dd className="text-ink-muted">{values.websiteUrl || "No website"}</dd>
              </div>
              <div>
                <dt className="font-medium">WhatsApp</dt>
                <dd className="text-ink-muted">{String(values.whatsappNumber)}</dd>
              </div>
              <div>
                <dt className="font-medium">Photos</dt>
                <dd className="text-ink-muted">
                  {portfolio.length} portfolio {portfolio.length === 1 ? "photo" : "photos"}
                  {logo ? " and a logo" : ""}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => setStep(0)}
              className="mt-3 text-sm font-medium text-terracotta underline"
            >
              Edit details
            </button>
          </div>

          <FormMessage kind="info">
            {mode === "register"
              ? "Every business is reviewed by our team before it appears on KreateSpace. We’ll show you the decision in your dashboard."
              : "Your current profile stays live until our team approves these changes."}
          </FormMessage>

          <div className="space-y-3">
            <CheckboxField
              label="I agree to the KreateSpace seller terms."
              checked={agreements.termsAccepted}
              error={agreementErrors.termsAccepted}
              onChange={(event) =>
                setAgreements((c) => ({ ...c, termsAccepted: event.target.checked }))
              }
            />
            <CheckboxField
              label="I own, or have permission to share, every image and description I’ve provided, and I authorise KreateSpace to display them."
              checked={agreements.contentAuthorization}
              error={agreementErrors.contentAuthorization}
              onChange={(event) =>
                setAgreements((c) => ({ ...c, contentAuthorization: event.target.checked }))
              }
            />
          </div>

          <div className="flex gap-3">
            <SecondaryButton type="button" onClick={() => setStep(1)}>
              Back
            </SecondaryButton>
            <PrimaryButton
              type="button"
              className="flex-1"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving
                ? "Submitting…"
                : mode === "register"
                  ? "Submit for review"
                  : "Submit update for review"}
            </PrimaryButton>
          </div>
        </section>
      ) : null}
    </div>
  );
}
