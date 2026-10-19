import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MAX_PACKAGES, packageContentSchema } from "@kreatespace/shared";
import { useState, type ChangeEvent } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import {
  FormMessage,
  PrimaryButton,
  SecondaryButton,
  TextAreaField,
  TextField,
} from "../../components/forms";
import { Photo } from "../../components/gallery";
import { StatusBadge } from "../../components/StatusBadge";
import { ApiError } from "../../lib/api";
import { portfolioKeys } from "../../lib/portfolio";
import { useApi } from "../../lib/queries";
import type { OwnPackage } from "../../lib/types";
import { prepareImage, uploadRequestFor, uploadToStorage } from "../../lib/uploads";

interface PackageList {
  packages: OwnPackage[];
  usage: { used: number; limit: number };
}

const message = (error: unknown) =>
  error instanceof ApiError || error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

const kes = new Intl.NumberFormat("en-KE");

interface FormValues {
  name: string;
  description: string;
  includesText: string;
  startingPrice: string;
}

// --- editor ---------------------------------------------------------------------------------------

function PackageEditor({
  pkg,
  onSaved,
  onCancel,
}: {
  pkg: OwnPackage | null;
  onSaved: (saved: OwnPackage) => void;
  onCancel?: () => void;
}) {
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const draft = pkg?.draft;
  const editable = pkg ? pkg.editable : true;

  const {
    register,
    handleSubmit,
    setError: setFieldError,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      name: draft?.name ?? "",
      description: draft?.description ?? "",
      includesText: (draft?.includes ?? []).join("\n"),
      startingPrice: draft?.startingPriceKes ? String(draft.startingPriceKes) : "",
    },
  });

  function toContent(values: FormValues) {
    return {
      name: values.name,
      description: values.description,
      includes: values.includesText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      startingPriceKes: values.startingPrice.trim()
        ? Number(values.startingPrice.replace(/,/g, ""))
        : null,
    };
  }

  const save = handleSubmit(async (values) => {
    setError(null);
    setNotice(null);
    const parsed = packageContentSchema.safeParse(toContent(values));
    if (!parsed.success) {
      const map: Record<string, keyof FormValues> = {
        name: "name",
        description: "description",
        includes: "includesText",
        startingPriceKes: "startingPrice",
      };
      for (const issue of parsed.error.issues) {
        const field = map[String(issue.path[0])];
        if (field) setFieldError(field, { message: issue.message });
      }
      return;
    }
    setBusy(true);
    try {
      const saved = pkg
        ? await api.patch<OwnPackage>(`/api/packages/${pkg.id}`, parsed.data)
        : await api.post<OwnPackage>("/api/packages", parsed.data);
      onSaved(saved);
      setNotice("Package saved.");
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  });

  async function onImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !pkg) return;
    setImageStatus("Preparing the photo…");
    const prepared = await prepareImage(file);
    if ("error" in prepared) {
      setImageStatus(prepared.error);
      return;
    }
    setImageStatus("Uploading…");
    try {
      const target = await api.post<{ path: string; token: string }>(
        `/api/packages/${pkg.id}/image-upload`,
        uploadRequestFor(prepared.file),
      );
      await uploadToStorage(target.path, target.token, prepared.file);
      setImageStatus("Checking the photo…");
      onSaved(await api.post<OwnPackage>(`/api/packages/${pkg.id}/image`, { path: target.path }));
      setImageStatus("Photo added.");
    } catch (failure) {
      setImageStatus(`Couldn’t add the photo. ${message(failure)}`);
    }
  }

  async function act(action: () => Promise<OwnPackage>, success: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      onSaved(await action());
      setNotice(success);
    } catch (failure) {
      setError(
        failure instanceof ApiError && Object.keys(failure.fields).length > 0
          ? Object.values(failure.fields).join(" ")
          : message(failure),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-4 border-t border-sand pt-4">
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {notice ? <FormMessage kind="success">{notice}</FormMessage> : null}
      <form onSubmit={save} noValidate className="space-y-4" aria-label="Package details">
        <TextField
          label="Package name"
          required
          disabled={!editable}
          error={errors.name?.message}
          {...register("name")}
        />
        <TextAreaField
          label="Description"
          required
          rows={3}
          disabled={!editable}
          error={errors.description?.message}
          {...register("description")}
        />
        <TextAreaField
          label="What’s included"
          required
          rows={4}
          disabled={!editable}
          hint="One item per line, for example: Event coverage"
          error={errors.includesText?.message}
          {...register("includesText")}
        />
        <TextField
          label="Starting price (KSh)"
          optional
          inputMode="numeric"
          disabled={!editable}
          hint="Only add a price if you’re happy to show one. Leave it blank to let customers ask you."
          error={errors.startingPrice?.message}
          {...register("startingPrice")}
        />
        {editable ? (
          <div className="flex flex-wrap gap-3">
            <PrimaryButton type="submit" disabled={busy} className="w-auto">
              {busy ? "Saving…" : pkg ? "Save changes" : "Save package"}
            </PrimaryButton>
            {onCancel ? (
              <SecondaryButton type="button" onClick={onCancel}>
                Close
              </SecondaryButton>
            ) : null}
          </div>
        ) : null}
      </form>

      {pkg ? (
        <div>
          <p className="text-sm font-medium">Photo (optional)</p>
          {draft?.image ? (
            <div className="mt-2 w-40">
              <Photo image={draft.image} alt="Package photo" sizes="160px" />
            </div>
          ) : null}
          {editable ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="text-sm font-medium text-terracotta underline">
                <span className="cursor-pointer">
                  {draft?.image ? "Replace photo" : "Add a photo"}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => void onImage(event)}
                  className="sr-only"
                  aria-label="Package photo"
                />
              </label>
              {draft?.image ? (
                <button
                  type="button"
                  className="text-sm font-medium text-red-700 underline"
                  onClick={() =>
                    void act(
                      () => api.delete<OwnPackage>(`/api/packages/${pkg.id}/image`),
                      "Photo removed.",
                    )
                  }
                >
                  Remove photo
                </button>
              ) : null}
            </div>
          ) : null}
          <p aria-live="polite" className="mt-1 text-sm text-ink-muted">
            {imageStatus}
          </p>
        </div>
      ) : null}

      {pkg && editable ? (
        <div className="flex flex-wrap gap-3 border-t border-sand pt-4">
          <PrimaryButton
            type="button"
            className="w-auto"
            disabled={busy}
            onClick={() =>
              void act(
                () => api.post<OwnPackage>(`/api/packages/${pkg.id}/submit`),
                "Submitted for review.",
              )
            }
          >
            Submit for review
          </PrimaryButton>
        </div>
      ) : null}
    </div>
  );
}

// --- page -----------------------------------------------------------------------------------------

export function PackagesPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: portfolioKeys.packages,
    queryFn: () => api.get<PackageList>("/api/packages"),
  });
  const [openId, setOpenId] = useState<string | "new" | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdNotice, setCreatedNotice] = useState<string | null>(null);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: portfolioKeys.packages });
  }

  async function archive(id: string) {
    setError(null);
    try {
      await api.post(`/api/packages/${id}/archive`);
      setConfirmArchive(null);
      await refresh();
    } catch (failure) {
      setError(message(failure));
    }
  }

  if (list.isPending) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10" role="status">
        Loading…
      </main>
    );
  }
  if (list.isError) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <FormMessage kind="error">We couldn’t load your packages. Please try again.</FormMessage>
      </main>
    );
  }

  const { packages, usage } = list.data;
  const visible = packages.filter((p) => p.status !== "ARCHIVED");

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link to="/seller" className="text-sm font-medium text-terracotta underline">
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Service packages</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Optional bundles customers can ask you about, such as “Wedding photography” with what’s
        included. Each package is reviewed before it appears on your public profile. You’ve used{" "}
        {usage.used} of {MAX_PACKAGES}.
      </p>
      {error ? (
        <div className="mt-3">
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      ) : null}
      {createdNotice ? (
        <div className="mt-3">
          <FormMessage kind="success">{createdNotice}</FormMessage>
        </div>
      ) : null}

      <div className="mt-5">
        {openId === "new" ? (
          <section className="rounded-xl border border-sand bg-white p-5" aria-label="New package">
            <h2 className="text-lg font-semibold">New package</h2>
            <PackageEditor
              pkg={null}
              onCancel={() => setOpenId(null)}
              onSaved={(saved) => {
                setOpenId(saved.id);
                setCreatedNotice(
                  "Package saved. You can now add a photo and submit it for review.",
                );
                void refresh();
              }}
            />
          </section>
        ) : usage.used >= usage.limit ? (
          <p className="text-sm text-ink-muted">
            You’ve reached the limit. Archive a package to add another.
          </p>
        ) : (
          <PrimaryButton type="button" className="w-auto" onClick={() => setOpenId("new")}>
            Add a package
          </PrimaryButton>
        )}
      </div>

      {visible.length === 0 && openId !== "new" ? (
        <p className="mt-6 text-sm text-ink-muted">You haven’t added any service packages yet.</p>
      ) : (
        <ul className="mt-6 space-y-4" aria-label="Your packages">
          {visible.map((pkg) => (
            <li key={pkg.id} className="rounded-xl border border-sand bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">{pkg.draft.name}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusBadge status={pkg.reviewState} />
                    {pkg.status === "SUSPENDED" ? <StatusBadge status="SUSPENDED" /> : null}
                    {pkg.hasPublishedVersion && pkg.reviewState !== "APPROVED" ? (
                      <span className="text-xs text-ink-muted">Live version unchanged</span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-ink-muted">
                    {pkg.draft.startingPriceKes
                      ? `From KSh ${kes.format(pkg.draft.startingPriceKes)}`
                      : "No price shown"}
                  </p>
                  {["CHANGES_REQUESTED", "REJECTED", "SUSPENDED"].includes(
                    pkg.latestFeedback?.action ?? "",
                  ) && pkg.latestFeedback?.reason ? (
                    <blockquote className="mt-2 rounded-md border-l-4 border-terracotta bg-cream p-2 text-sm">
                      <p className="font-medium">Feedback from our team</p>
                      <p>{pkg.latestFeedback.reason}</p>
                    </blockquote>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-3 text-sm">
                  <button
                    type="button"
                    className="font-medium text-terracotta underline"
                    aria-expanded={openId === pkg.id}
                    onClick={() => setOpenId(openId === pkg.id ? null : pkg.id)}
                  >
                    {openId === pkg.id ? "Close" : pkg.editable ? "Edit" : "View"}
                  </button>
                  {confirmArchive === pkg.id ? (
                    <>
                      <button
                        type="button"
                        className="font-medium text-red-700 underline"
                        onClick={() => void archive(pkg.id)}
                      >
                        Yes, archive
                      </button>
                      <button
                        type="button"
                        className="font-medium underline"
                        onClick={() => setConfirmArchive(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="font-medium text-red-700 underline"
                      onClick={() => setConfirmArchive(pkg.id)}
                      aria-label={`Archive ${pkg.draft.name}`}
                    >
                      Archive
                    </button>
                  )}
                </div>
              </div>
              {openId === pkg.id ? (
                <PackageEditor
                  key={pkg.updatedAt}
                  pkg={pkg}
                  onCancel={() => setOpenId(null)}
                  onSaved={() => void refresh()}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
