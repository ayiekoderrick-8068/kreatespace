import { Link } from "react-router";
import {
  DELETION_GRACE_DAYS,
  INVITATION_VALID_DAYS,
  MAX_ACTIVE_CREATIONS,
  MAX_IMAGES_PER_CREATION,
  MAX_PACKAGES,
} from "@kreatespace/shared";
import { LEGAL_DETAILS, LegalPage, Placeholder } from "./LegalPage";

/** Terms for businesses that list on KreateSpace. A draft for legal review. */
export function SellerTermsPage() {
  return (
    <LegalPage
      title="Seller Terms"
      description="The terms for businesses that list their work on KreateSpace."
      summary="These terms apply when you register a business on KreateSpace and publish its profile, creations and packages. You agree to them when you submit your application."
      sections={[
        {
          id: "who",
          title: "Who these terms are between",
          body: (
            <p>
              They are between you (the business, and the person registering it) and{" "}
              <Placeholder>{LEGAL_DETAILS.operatorName}</Placeholder>, which runs KreateSpace. You
              confirm you have authority to bind the business. The{" "}
              <Link to="/terms" className="text-terracotta underline">
                Terms of Use
              </Link>{" "}
              and{" "}
              <Link to="/privacy" className="text-terracotta underline">
                Privacy Policy
              </Link>{" "}
              also apply.
            </p>
          ),
        },
        {
          id: "pilot",
          title: "The pilot and invitations",
          body: (
            <p>
              During the pilot, businesses join by invitation. An invitation works once, for the
              email address it was sent to, and expires after {INVITATION_VALID_DAYS} days. Fees:{" "}
              <Placeholder>{LEGAL_DETAILS.fees}</Placeholder>. We may change how the service works
              after the pilot and will tell you before charging for anything.
            </p>
          ),
        },
        {
          id: "accuracy",
          title: "Your information must be true",
          body: (
            <p>
              Everything you give us — your business name, location, WhatsApp number, website,
              descriptions, photographs and any price — must be accurate and kept up to date. Do not
              imply a qualification, endorsement or result you do not have.
            </p>
          ),
        },
        {
          id: "content-rights",
          title: "Your content and your permission",
          body: (
            <>
              <p>
                When you tick the box in the application you confirm that you{" "}
                <strong>own, or have permission to share, every image and description</strong> you
                provide, including work done for clients, and that doing so does not infringe anyone
                else’s rights.
              </p>
              <p>
                You keep ownership of your content. You give KreateSpace a non-exclusive licence to
                store, resize, display and promote it on KreateSpace and in link previews for as
                long as it is published, and to keep technical copies for backups for the period in
                the Privacy Policy. The licence ends when your content is removed, apart from copies
                kept for backups until they expire.
              </p>
            </>
          ),
        },
        {
          id: "review",
          title: "Review and moderation",
          body: (
            <>
              <p>
                Our team reviews your business before it appears, every creation and package before
                it appears, and every later change before it replaces what is live. While a change
                is waiting, the approved version stays public. We may approve, ask for changes,
                reject, or remove content or suspend your business — for example for inaccurate,
                misleading, unlawful or infringing content, complaints, or breaking these terms —
                and will give the reason where we can.
              </p>
              <p>
                Approval is not an endorsement. You remain responsible for your content and your
                dealings with customers.
              </p>
            </>
          ),
        },
        {
          id: "limits",
          title: "What you can publish",
          body: (
            <ul className="list-disc space-y-1 pl-6">
              <li>Up to {MAX_ACTIVE_CREATIONS} active creations (archived ones do not count).</li>
              <li>Up to {MAX_IMAGES_PER_CREATION} photographs per creation, JPEG, PNG or WebP.</li>
              <li>Up to {MAX_PACKAGES} service packages. A price is shown only if you add one.</li>
              <li>
                No unlawful, deceptive, hateful, sexually explicit or dangerous content, and nothing
                that infringes someone’s rights.
              </li>
            </ul>
          ),
        },
        {
          id: "customers",
          title: "Your dealings with customers",
          body: (
            <p>
              Customers contact you on WhatsApp or through your website.{" "}
              <strong>Your WhatsApp number is published</strong> on your profile through the contact
              button, and customers you message or who message you will see it in WhatsApp.
              KreateSpace does not take payments, handle orders or deliveries, or take part in your
              agreements. You are responsible for your prices, quality, delivery, refunds, taxes and
              the law that applies to your trade. Handle customers’ personal data you receive
              lawfully.
            </p>
          ),
        },
        {
          id: "website-import",
          title: "Importing from your website",
          body: (
            <p>
              If you ask, an administrator may copy pages from <strong>your own website</strong>{" "}
              into draft creations. This happens only for the website address on your approved
              profile, only after you have confirmed you own the content, and only while the
              permission stands; you can withdraw it at any time. Imported drafts are not published
              until you submit them and our team approves them.
            </p>
          ),
        },
        {
          id: "analytics",
          title: "Analytics and website help",
          body: (
            <p>
              We show you counts of page views and of times the WhatsApp or website link was opened.
              They say nothing about who looked, and a WhatsApp click does not mean a message was
              sent. If you ask for help with a website, our reply is not a binding offer unless we
              say so in writing.
            </p>
          ),
        },
        {
          id: "ending",
          title: "Leaving, suspension and deletion",
          body: (
            <>
              <p>
                You can ask us to delete your account from your account page. Because it removes
                your business from KreateSpace, an administrator checks the request first (for
                example that no website request or import is in progress). You then have{" "}
                {DELETION_GRACE_DAYS} days to change your mind.
              </p>
              <p>
                When deletion is carried out, your business profile, creations, packages,
                photographs, analytics for your business, website requests and import records are
                permanently deleted. Copies in backups expire within{" "}
                <Placeholder>{LEGAL_DETAILS.backupRetention}</Placeholder>. A minimal record that a
                deletion took place, with no personal details, is kept for accountability.
              </p>
              <p>
                We may suspend your business immediately, or end these terms, if you seriously or
                repeatedly break them.
              </p>
            </>
          ),
        },
        {
          id: "responsibility",
          title: "Responsibility",
          body: (
            <p>
              You are responsible to us for losses caused by your content or by breaking these
              terms.{" "}
              <Placeholder>
                [Indemnity and the limits of our responsibility to you — a lawyer must write and
                confirm these under Kenyan law.]
              </Placeholder>
            </p>
          ),
        },
        {
          id: "changes",
          title: "Changes and contact",
          body: (
            <p>
              We will tell you before important changes take effect, by email and on your dashboard.
              If you do not agree, you can leave. These terms are governed by the laws of Kenya.{" "}
              <Placeholder>[Courts and dispute process — to be confirmed by a lawyer.]</Placeholder>{" "}
              Contact: <Placeholder>{LEGAL_DETAILS.contactEmail}</Placeholder>.
            </p>
          ),
        },
      ]}
    />
  );
}
