import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  MAX_ACTIVE_CREATIONS,
  MAX_IMAGES_PER_CREATION,
  creationDetailsSchema,
  type CreationDetails,
  type CreationDetailsInput,
} from "@kreatespace/shared";
import { useState, type ChangeEvent } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import {
  FormMessage,
  PrimaryButton,
  SecondaryButton,
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/forms";
import { Photo } from "../../components/gallery";
import { StatusBadge } from "../../components/StatusBadge";
import { ApiError } from "../../lib/api";
import { portfolioKeys, useOccasions, useOwnCreation } from "../../lib/portfolio";
import { useApi, useCategories } from "../../lib/queries";
import type { OwnCreation, SellerImage } from "../../lib/types";
import { prepareImage, uploadRequestFor, uploadToStorage } from "../../lib/uploads";

const message = (error: unknown) =>
  error instanceof ApiError || error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

// --- details form --------------------------------------------------------------------------------

function DetailsForm({
  defaults,
  disabled,
  submitLabel,
  onSubmit,
  secondary,
}: {
  defaults?: CreationDetailsInput;
  disabled?: boolean;
  submitLabel: string;
  onSubmit: (values: CreationDetails) => Promise<void>;
  secondary?: React.ReactNode;
}) {
  const categories = useCategories();
  const occasions = useOccasions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    formState: { errors },
  } = useForm<CreationDetailsInput, unknown, CreationDetails>({
    resolver: zodResolver(creationDetailsSchema),
    defaultValues: defaults ?? { title: "", description: "", categoryId: "", occasionId: "" },
  });

  // Selects can only show a saved value once their options exist.
  if (categories.isPending || occasions.isPending) {
    return (
      <p role="status" className="text-sm text-ink-muted">
        Loading…
      </p>
    );
  }

  const submit = handleSubmit(async (values) => {
    setError(null);
    setBusy(true);
    try {
      await onSubmit({ ...values, occasionId: values.occasionId || null });
    } catch (failure) {
      if (failure instanceof ApiError) {
        for (const [field, text] of Object.entries(failure.fields)) {
          if (field in values)
            setFieldError(field as keyof CreationDetailsInput, { message: text });
        }
      }
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="Creation details">
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <TextField
        label="Title"
        required
        disabled={disabled}
        hint="What is it? For example “Floral birthday cake”."
        error={errors.title?.message}
        {...register("title")}
      />
      <TextAreaField
        label="Description"
        required
        disabled={disabled}
        hint="Describe what you made and what makes it special. Don’t include prices here."
        error={errors.description?.message}
        {...register("description")}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Category"
          required
          disabled={disabled}
          placeholder="Choose a category"
          options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          error={errors.categoryId?.message}
          {...register("categoryId")}
        />
        <SelectField
          label="Occasion"
          optional
          disabled={disabled}
          placeholder="No particular occasion"
          options={(occasions.data ?? []).map((o) => ({ value: o.id, label: o.name }))}
          error={errors.occasionId?.message}
          {...register("occasionId")}
        />
      </div>
      {disabled ? null : (
        <div className="flex flex-wrap gap-3">
          <PrimaryButton type="submit" disabled={busy} className="w-auto">
            {busy ? "Saving…" : submitLabel}
          </PrimaryButton>
          {secondary}
        </div>
      )}
    </form>
  );
}

// --- create ---------------------------------------------------------------------------------------

export function CreationNewPage() {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/seller" className="text-sm font-medium text-terracotta underline">
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Add a new creation</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Start with the details. You’ll add photos next, and nothing is public until our team
        approves it. You can have up to {MAX_ACTIVE_CREATIONS} creations on the free plan.
      </p>
      <div className="mt-6">
        <DetailsForm
          submitLabel="Save draft and add photos"
          onSubmit={async (values) => {
            const { creationId } = await api.post<{ creationId: string }>("/api/creations", values);
            await queryClient.invalidateQueries({ queryKey: portfolioKeys.list });
            navigate(`/seller/creations/${creationId}`, { replace: true });
          }}
        />
      </div>
    </main>
  );
}

// --- photos -----------------------------------------------------------------------------------------

type UploadState = {
  name: string;
  state: "uploading" | "checking" | "done" | "failed";
  error?: string;
};

function PhotoManager({
  data,
  onChange,
}: {
  data: OwnCreation;
  onChange: (updated: OwnCreation) => void;
}) {
  const api = useApi();
  const id = data.creation.id;
  const editable = data.creation.editable;
  const images = data.revision.images;
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const room = MAX_IMAGES_PER_CREATION - images.length;

  function track(index: number, patch: Partial<UploadState>) {
    setUploads((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setError(
      files.length > room ? `You can add ${room} more ${room === 1 ? "photo" : "photos"}.` : null,
    );

    const chosen = files.slice(0, Math.max(room, 0));
    setUploads(chosen.map((file) => ({ name: file.name, state: "uploading" })));
    setBusy(true);
    for (const [index, file] of chosen.entries()) {
      const prepared = await prepareImage(file);
      if ("error" in prepared) {
        track(index, { state: "failed", error: prepared.error });
        continue;
      }
      try {
        const target = await api.post<{ path: string; token: string }>(
          `/api/creations/${id}/uploads`,
          uploadRequestFor(prepared.file),
        );
        await uploadToStorage(target.path, target.token, prepared.file);
        track(index, { state: "checking" });
        onChange(await api.post<OwnCreation>(`/api/creations/${id}/images`, { path: target.path }));
        track(index, { state: "done" });
      } catch (failure) {
        track(index, { state: "failed", error: message(failure) });
      }
    }
    setBusy(false);
  }

  async function move(image: SellerImage, direction: -1 | 1) {
    const ids = images.map((i) => i.id);
    const from = ids.indexOf(image.id);
    const to = from + direction;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    setError(null);
    try {
      onChange(await api.put<OwnCreation>(`/api/creations/${id}/images/order`, { imageIds: ids }));
    } catch (failure) {
      setError(message(failure));
    }
  }

  async function remove(image: SellerImage) {
    setError(null);
    try {
      onChange(await api.delete<OwnCreation>(`/api/creations/${id}/images/${image.id}`));
    } catch (failure) {
      setError(message(failure));
    }
  }

  return (
    <section aria-labelledby="photos-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="photos-heading" className="text-lg font-semibold">
          Photos
        </h2>
        <p className="text-sm text-ink-muted">
          {images.length} of {MAX_IMAGES_PER_CREATION} photos
        </p>
      </div>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      {images.length === 0 ? (
        <p className="text-sm text-ink-muted">No photos yet. Add at least one before you submit.</p>
      ) : (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image, index) => (
            <li key={image.id} className="rounded-xl border border-sand bg-white p-2">
              <Photo
                image={{ url: image.url, srcSet: null, width: image.width, height: image.height }}
                alt={`Photo ${index + 1}`}
                sizes="200px"
              />
              <p className="mt-1 text-xs text-ink-muted">
                {index === 0 ? "Cover photo" : `Photo ${index + 1}`}
              </p>
              {editable ? (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  <button
                    type="button"
                    onClick={() => void move(image, -1)}
                    disabled={index === 0}
                    aria-label={`Move photo ${index + 1} earlier`}
                    className="font-medium text-terracotta underline disabled:opacity-40 disabled:no-underline"
                  >
                    Earlier
                  </button>
                  <button
                    type="button"
                    onClick={() => void move(image, 1)}
                    disabled={index === images.length - 1}
                    aria-label={`Move photo ${index + 1} later`}
                    className="font-medium text-terracotta underline disabled:opacity-40 disabled:no-underline"
                  >
                    Later
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(image)}
                    aria-label={`Remove photo ${index + 1}`}
                    className="font-medium text-red-700 underline"
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {editable ? (
        <div>
          <label htmlFor="creation-photos" className="block text-sm font-medium">
            Add photos
          </label>
          <input
            id="creation-photos"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy || room <= 0}
            onChange={(event) => void onFiles(event)}
            className="mt-1 block w-full text-sm"
          />
          <p className="mt-1 text-xs text-ink-muted">
            JPEG, PNG or WebP, up to 5 MB each. Only upload photos you own or may share.
          </p>
        </div>
      ) : null}

      <ul aria-live="polite" className="space-y-1 text-sm">
        {uploads.map((upload, index) => (
          <li
            key={`${upload.name}-${index}`}
            className={upload.state === "failed" ? "text-red-700" : "text-ink-muted"}
          >
            {upload.name}:{" "}
            {upload.state === "uploading"
              ? "uploading…"
              : upload.state === "checking"
                ? "checking the photo…"
                : upload.state === "done"
                  ? "added"
                  : `couldn’t be added. ${upload.error ?? ""}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- editor -----------------------------------------------------------------------------------------

export function CreationEditorPage() {
  const { id = "" } = useParams();
  const api = useApi();
  const queryClient = useQueryClient();
  const creation = useOwnCreation(id);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [busy, setBusy] = useState(false);

  async function applied(updated: OwnCreation) {
    queryClient.setQueryData(portfolioKeys.one(id), updated);
    await queryClient.invalidateQueries({ queryKey: portfolioKeys.list });
  }

  async function run(action: () => Promise<OwnCreation>, success?: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await applied(await action());
      if (success) setNotice(success);
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.fields.images
          ? failure.fields.images
          : message(failure),
      );
    } finally {
      setBusy(false);
    }
  }

  if (creation.isPending) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10" role="status">
        Loading…
      </main>
    );
  }
  if (creation.isError) {
    const missing =
      creation.error instanceof ApiError && [400, 404].includes(creation.error.status);
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <FormMessage kind="error">
          {missing ? "We couldn’t find that creation." : "We couldn’t load this creation."}
        </FormMessage>
        <Link to="/seller" className="mt-4 inline-block font-medium text-terracotta underline">
          Back to dashboard
        </Link>
      </main>
    );
  }

  const data = creation.data;
  const { status, editable, canStartRevision } = data.creation;
  const feedback = data.decisions.find((d) =>
    ["CHANGES_REQUESTED", "REJECTED", "SUSPENDED"].includes(d.action),
  );
  const showFeedback =
    feedback?.reason &&
    (["CHANGES_REQUESTED", "REJECTED", "SUSPENDED"].includes(status) ||
      ["CHANGES_REQUESTED", "REJECTED"].includes(data.revision.status));
  const hasLiveVersion = data.publishedRevision !== null || status === "APPROVED";

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/seller" className="text-sm font-medium text-terracotta underline">
        ← Dashboard
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{data.revision.title}</h1>
        <StatusBadge status={status} />
        {data.publishedRevision ||
        (status === "APPROVED" && data.revision.status !== "APPROVED") ? (
          <StatusBadge status={data.revision.status} />
        ) : null}
      </div>

      <div className="mt-4 space-y-3" aria-live="polite">
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        {notice ? <FormMessage kind="success">{notice}</FormMessage> : null}
        {showFeedback ? (
          <blockquote className="rounded-md border-l-4 border-terracotta bg-cream p-3 text-sm">
            <p className="font-medium">Feedback from our team</p>
            <p className="mt-1 whitespace-pre-line">{feedback!.reason}</p>
          </blockquote>
        ) : null}
        {status === "PENDING" || data.revision.status === "PENDING" ? (
          <FormMessage kind="info">
            Awaiting review.
            {hasLiveVersion
              ? " Your current approved version stays live until it’s approved."
              : " It isn’t public yet."}
          </FormMessage>
        ) : null}
        {status === "SUSPENDED" ? (
          <FormMessage kind="error">
            This creation is suspended and hidden from customers.
          </FormMessage>
        ) : null}
        {status === "ARCHIVED" ? (
          <FormMessage kind="info">
            This creation is archived. It’s hidden from customers and no longer uses a slot.
          </FormMessage>
        ) : null}
      </div>

      {canStartRevision ? (
        <section className="mt-5 rounded-xl border border-sand bg-white p-4">
          <p className="text-sm text-ink-muted">
            {status === "APPROVED"
              ? "This creation is live. You can edit it — your changes are reviewed first, and the live version stays as it is until they’re approved."
              : "This submission wasn’t approved. Start a new version to make changes and submit it again."}
          </p>
          <div className="mt-3 max-w-xs">
            <PrimaryButton
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () => api.post<OwnCreation>(`/api/creations/${id}/revisions`),
                  "You can now edit this creation.",
                )
              }
            >
              {status === "APPROVED" ? "Edit this creation" : "Start a new version"}
            </PrimaryButton>
          </div>
        </section>
      ) : null}

      <div className="mt-6 space-y-8">
        <DetailsForm
          key={data.revision.id + data.revision.title}
          disabled={!editable}
          submitLabel="Save changes"
          defaults={{
            title: data.revision.title,
            description: data.revision.description,
            categoryId: data.revision.category.id,
            occasionId: data.revision.occasion?.id ?? "",
          }}
          onSubmit={async (values) => {
            await applied(await api.patch<OwnCreation>(`/api/creations/${id}`, values));
            setNotice("Changes saved.");
          }}
        />

        <PhotoManager data={data} onChange={(updated) => void applied(updated)} />

        {editable ? (
          <section
            aria-labelledby="submit-heading"
            className="rounded-xl border border-sand bg-white p-4"
          >
            <h2 id="submit-heading" className="text-lg font-semibold">
              Ready to publish?
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Our team reviews every creation before it appears on KreateSpace. You’ll see the
              decision here.
            </p>
            <div className="mt-3 max-w-xs">
              <PrimaryButton
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => api.post<OwnCreation>(`/api/creations/${id}/submit`),
                    "Submitted for review.",
                  )
                }
              >
                Submit for review
              </PrimaryButton>
            </div>
          </section>
        ) : null}

        {status !== "ARCHIVED" ? (
          <section aria-labelledby="archive-heading" className="border-t border-sand pt-4">
            <h2 id="archive-heading" className="text-sm font-semibold">
              Archive
            </h2>
            {archiving ? (
              <div className="mt-2 space-y-2">
                <FormMessage kind="info">
                  Archive this creation? It will be removed from discovery and free up one of your{" "}
                  {MAX_ACTIVE_CREATIONS} slots.
                </FormMessage>
                <div className="flex gap-3">
                  <PrimaryButton
                    type="button"
                    className="w-auto"
                    disabled={busy}
                    onClick={() => {
                      setArchiving(false);
                      void run(
                        () => api.post<OwnCreation>(`/api/creations/${id}/archive`),
                        "Creation archived.",
                      );
                    }}
                  >
                    Yes, archive it
                  </PrimaryButton>
                  <SecondaryButton type="button" onClick={() => setArchiving(false)}>
                    Cancel
                  </SecondaryButton>
                </div>
              </div>
            ) : (
              <SecondaryButton type="button" className="mt-2" onClick={() => setArchiving(true)}>
                Archive creation
              </SecondaryButton>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}
