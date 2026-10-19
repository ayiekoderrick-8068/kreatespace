import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createInvitationSchema, type CreateInvitationInput } from "@kreatespace/shared";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { FormMessage, PrimaryButton, SecondaryButton, TextField } from "../../components/forms";
import { StatusBadge } from "../../components/StatusBadge";
import { ApiError } from "../../lib/api";
import { queryKeys, useApi } from "../../lib/queries";
import type { Invitation } from "../../lib/types";

const dateFormat = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium" });

export function InvitationsPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const invitations = useQuery({
    queryKey: queryKeys.invitations,
    queryFn: async () =>
      (await api.get<{ invitations: Invitation[] }>("/api/admin/invitations")).invitations,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateInvitationInput>({ resolver: zodResolver(createInvitationSchema) });

  const create = useMutation({
    mutationFn: (input: CreateInvitationInput) =>
      api.post<{ invitation: Invitation; inviteUrl: string }>("/api/admin/invitations", input),
    onSuccess: async (result) => {
      setCreated({ email: result.invitation.email, url: result.inviteUrl });
      setCopied(false);
      reset();
      await queryClient.invalidateQueries({ queryKey: queryKeys.invitations });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/api/admin/invitations/${id}/revoke`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.invitations }),
  });

  async function copyLink() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const createError = create.error instanceof ApiError ? create.error.message : null;

  return (
    <div className="space-y-8">
      <section
        aria-labelledby="invite-heading"
        className="rounded-xl border border-cream-dark bg-white p-5"
      >
        <h2 id="invite-heading" className="text-lg font-semibold">
          Invite a business owner
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          During the pilot, only invited people can register a business. Invitations expire after 14
          days and work once, for that email address only.
        </p>
        <form
          onSubmit={handleSubmit((values) => create.mutate(values))}
          noValidate
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <TextField
              label="Email address"
              type="email"
              autoComplete="off"
              error={errors.email?.message}
              {...register("email")}
            />
          </div>
          <PrimaryButton type="submit" disabled={create.isPending} className="sm:w-auto">
            {create.isPending ? "Creating…" : "Create invitation"}
          </PrimaryButton>
        </form>
        {createError ? (
          <div className="mt-3">
            <FormMessage kind="error">{createError}</FormMessage>
          </div>
        ) : null}
        {created ? (
          <div className="mt-4 rounded-md bg-cream p-4">
            <p className="text-sm font-medium">
              Invitation created for {created.email}. Share this link with them — it won’t be shown
              again.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                aria-label="Invitation link"
                value={created.url}
                onFocus={(event) => event.currentTarget.select()}
                className="flex-1 rounded-md border border-ink-muted/40 bg-white px-3 py-2 text-sm"
              />
              <SecondaryButton type="button" onClick={() => void copyLink()}>
                {copied ? "Copied" : "Copy link"}
              </SecondaryButton>
            </div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="list-heading">
        <h2 id="list-heading" className="text-lg font-semibold">
          All invitations
        </h2>
        {invitations.isPending ? (
          <p role="status" className="mt-3 text-ink-muted">
            Loading…
          </p>
        ) : invitations.isError ? (
          <div className="mt-3">
            <FormMessage kind="error">Couldn’t load invitations.</FormMessage>
          </div>
        ) : invitations.data.length === 0 ? (
          <p className="mt-3 text-ink-muted">No invitations yet.</p>
        ) : (
          <div
            role="region"
            aria-label="Invitations"
            tabIndex={0}
            className="mt-3 overflow-x-auto rounded-xl border border-cream-dark bg-white"
          >
            <table className="w-full text-left text-sm">
              <thead className="bg-cream-dark/60 text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Email
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Expires
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invitations.data.map((invitation) => (
                  <tr key={invitation.id} className="border-t border-cream-dark">
                    <td className="px-4 py-3">{invitation.email}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={invitation.status} kind="invitation" />
                    </td>
                    <td className="px-4 py-3">
                      {dateFormat.format(new Date(invitation.expiresAt))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {invitation.status === "PENDING" ? (
                        <button
                          type="button"
                          onClick={() => revoke.mutate(invitation.id)}
                          disabled={revoke.isPending}
                          className="font-medium text-red-700 underline disabled:opacity-60"
                          aria-label={`Revoke invitation for ${invitation.email}`}
                        >
                          Revoke
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
