import type { ReactNode } from "react";
import { Link } from "react-router";
import { LEGAL_VERSION } from "@kreatespace/shared";
import { usePageMeta } from "../lib/page-meta";

/**
 * Details the owner must supply. They are shown highlighted and in brackets so they cannot be
 * mistaken for real information. Nothing here is invented: no company name, address, registration
 * number or contact address exists until the owner provides it.
 */
export const LEGAL_DETAILS = {
  operatorName: "[Operator name — to be completed]",
  operatorAddress: "[Registered or postal address — to be completed]",
  contactEmail: "[General contact email — to be completed]",
  privacyEmail: "[Privacy contact email — to be completed]",
  reportEmail: "[Email for reporting content — to be completed]",
  registration: "[Data protection registration status and number, if required — to be confirmed]",
  minimumAge: "[18 — owner to confirm]",
  backupRetention: "[backup retention period — to be confirmed]",
  fees: "[fees, if any, after the pilot — to be confirmed]",
} as const;

/** A value the owner still has to provide. */
export function Placeholder({ children }: { children: ReactNode }) {
  return <mark className="rounded bg-amber-100 px-1 font-medium text-amber-900">{children}</mark>;
}

export const LAST_UPDATED = "19 October 2026";

interface Section {
  id: string;
  title: string;
  body: ReactNode;
}

/** The common frame for a legal document: draft notice, contents, numbered sections. */
export function LegalPage({
  title,
  summary,
  sections,
  description,
}: {
  title: string;
  /** One or two plain sentences that say what this document is for. */
  summary: ReactNode;
  sections: Section[];
  description: string;
}) {
  // Kept out of search results until the owner and a lawyer have approved the text.
  usePageMeta({ title, description, noindex: true });

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Version {LEGAL_VERSION} · Draft prepared {LAST_UPDATED}
      </p>

      <aside
        role="note"
        aria-label="Draft notice"
        className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
      >
        <p className="font-semibold">Draft for legal review</p>
        <p className="mt-1">
          This document has <strong>not</strong> been reviewed by a lawyer and is not yet approved
          by the owner of KreateSpace. Items in <Placeholder>[brackets]</Placeholder> are still to
          be completed. It describes how the service is designed to work; it is not legal advice and
          must not be relied on as a final agreement.
        </p>
      </aside>

      <p className="mt-6 text-lg">{summary}</p>

      <nav aria-label="Contents" className="mt-6 rounded-xl border border-sand bg-white p-4">
        <p className="text-sm font-medium">In this document</p>
        <ol className="mt-2 columns-1 gap-6 text-sm sm:columns-2">
          {sections.map((section, index) => (
            <li key={section.id} className="break-inside-avoid py-0.5">
              <a href={`#${section.id}`} className="text-terracotta underline">
                {index + 1}. {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-8 space-y-8">
        {sections.map((section, index) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`}>
            <h2 id={`${section.id}-heading`} className="text-xl font-semibold">
              {index + 1}. {section.title}
            </h2>
            <div className="mt-2 space-y-3 leading-relaxed text-ink">{section.body}</div>
          </section>
        ))}
      </div>

      <nav aria-label="Other documents" className="mt-12 border-t border-sand pt-6 text-sm">
        <p className="font-medium">Other documents</p>
        <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
          <li>
            <Link to="/terms" className="text-terracotta underline">
              Terms of Use
            </Link>
          </li>
          <li>
            <Link to="/privacy" className="text-terracotta underline">
              Privacy Policy
            </Link>
          </li>
          <li>
            <Link to="/seller-terms" className="text-terracotta underline">
              Seller Terms
            </Link>
          </li>
        </ul>
      </nav>
    </main>
  );
}
