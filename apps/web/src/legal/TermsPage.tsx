import { Link } from "react-router";
import { DELETION_GRACE_DAYS } from "@kreatespace/shared";
import { LEGAL_DETAILS, LegalPage, Placeholder } from "./LegalPage";

/** Terms of Use for visitors and customers. A draft for legal review. */
export function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      description="The terms for visiting and using KreateSpace as a customer."
      summary="These terms explain what KreateSpace is, what you can expect from it, and what we ask of you when you browse, create an account or contact a business."
      sections={[
        {
          id: "what-we-are",
          title: "What KreateSpace is",
          body: (
            <>
              <p>
                KreateSpace is a website where people in Kenya can discover creative businesses (for
                example bakers, designers, photographers and decorators), look at their work, and
                contact them. It is run by <Placeholder>{LEGAL_DETAILS.operatorName}</Placeholder>{" "}
                (“we”, “us”), reachable at <Placeholder>{LEGAL_DETAILS.contactEmail}</Placeholder>.
              </p>
              <p>
                <strong>
                  KreateSpace is not a shop and is not a party to your dealings with a business.
                </strong>{" "}
                We do not sell products or services, take payments, hold money, deliver goods or
                guarantee any business. Anything you agree with a business — price, delivery,
                quality, refunds — is between you and that business.
              </p>
            </>
          ),
        },
        {
          id: "using-the-site",
          title: "Browsing and your account",
          body: (
            <>
              <p>
                You can browse, search and view businesses without an account. An account lets you
                save creations. You must be at least{" "}
                <Placeholder>{LEGAL_DETAILS.minimumAge}</Placeholder> years old to create one.
              </p>
              <p>
                Give accurate details, keep your password private, and tell us if you think someone
                else has used your account. You are responsible for what happens under your login.
              </p>
            </>
          ),
        },
        {
          id: "contacting-businesses",
          title: "Contacting businesses on WhatsApp and their websites",
          body: (
            <>
              <p>
                The “Enquire on WhatsApp” button opens WhatsApp with a message already prepared for
                you to read, change and send yourself.{" "}
                <strong>We never see or send your message.</strong> Once you are in WhatsApp, Meta’s
                terms and privacy policy apply, and the business will see your phone number and name
                as WhatsApp shows them.
              </p>
              <p>
                Links to a business’s own website take you away from KreateSpace. We do not control
                those sites and are not responsible for them. We record that a link was opened (a
                count, with no information about you) so businesses can see how many people looked.
              </p>
            </>
          ),
        },
        {
          id: "content-accuracy",
          title: "Content on the site",
          body: (
            <>
              <p>
                Businesses write their own descriptions and add their own photos. Our team reviews
                each business and each creation before it appears, but a review is a basic check,
                not a guarantee that a description is accurate, that a business is reliable, or that
                its work matches the photographs. Prices appear only when a business chooses to show
                one.
              </p>
              <p>
                If you see something wrong, misleading or that you believe infringes your rights,
                tell us at <Placeholder>{LEGAL_DETAILS.reportEmail}</Placeholder> and we will look
                at it.
              </p>
            </>
          ),
        },
        {
          id: "acceptable-use",
          title: "What we ask of you",
          body: (
            <ul className="list-disc space-y-1 pl-6">
              <li>Do not use the site unlawfully, or to harass, deceive or defraud anyone.</li>
              <li>
                Do not try to access accounts or data that are not yours, probe or disrupt the
                service, or collect businesses’ details in bulk with automated tools.
              </li>
              <li>Do not send businesses unlawful, threatening or abusive messages.</li>
              <li>Do not copy a business’s photographs or text except as the law allows.</li>
            </ul>
          ),
        },
        {
          id: "ownership",
          title: "Ownership",
          body: (
            <p>
              Photographs and descriptions belong to the businesses that provide them. The
              KreateSpace name, design and software belong to us. You may view and share links to
              pages for personal use; anything more needs permission from the owner.
            </p>
          ),
        },
        {
          id: "your-data",
          title: "Your personal data",
          body: (
            <p>
              How we collect and use personal data, and your rights over it, are in our{" "}
              <Link to="/privacy" className="text-terracotta underline">
                Privacy Policy
              </Link>
              , which forms part of these terms.
            </p>
          ),
        },
        {
          id: "availability",
          title: "Availability and our responsibility",
          body: (
            <>
              <p>
                We try to keep KreateSpace available and accurate, but we provide it “as is”. It may
                be unavailable from time to time, and we may change or stop features.
              </p>
              <p>
                <Placeholder>
                  [A lawyer must confirm what limits on our responsibility Kenyan law allows. Do not
                  rely on this section until that is done.]
                </Placeholder>{" "}
                Nothing in these terms limits any right you have under law that cannot be limited.
              </p>
            </>
          ),
        },
        {
          id: "ending",
          title: "Closing your account",
          body: (
            <p>
              You can ask us to delete your account at any time from your account page. We wait{" "}
              {DELETION_GRACE_DAYS} days before deleting so you can change your mind. We may suspend
              or close an account that breaks these terms. Details are in the Privacy Policy.
            </p>
          ),
        },
        {
          id: "changes",
          title: "Changes to these terms",
          body: (
            <p>
              We may update these terms. When we make an important change we will say so on the site
              and, where we can, by email. Using KreateSpace after a change means you accept it.
            </p>
          ),
        },
        {
          id: "law",
          title: "Governing law and contact",
          body: (
            <p>
              These terms are governed by the laws of Kenya.{" "}
              <Placeholder>[Courts and dispute process — to be confirmed by a lawyer.]</Placeholder>{" "}
              Questions: <Placeholder>{LEGAL_DETAILS.contactEmail}</Placeholder>, or write to{" "}
              <Placeholder>{LEGAL_DETAILS.operatorAddress}</Placeholder>.
            </p>
          ),
        },
      ]}
    />
  );
}
