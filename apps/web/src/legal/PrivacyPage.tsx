import { Link } from "react-router";
import {
  ANALYTICS_RETENTION_MONTHS,
  DELETION_GRACE_DAYS,
  INVITATION_VALID_DAYS,
} from "@kreatespace/shared";
import { LEGAL_DETAILS, LegalPage, Placeholder } from "./LegalPage";

/** What data KreateSpace handles and why. A draft for legal review, written from the actual system. */
export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      description="What personal data KreateSpace collects, why, who sees it and what your rights are."
      summary="This explains what personal information KreateSpace handles, why, who can see it, how long we keep it, and what you can do about it."
      sections={[
        {
          id: "who",
          title: "Who is responsible for your data",
          body: (
            <>
              <p>
                <Placeholder>{LEGAL_DETAILS.operatorName}</Placeholder> (“we”) decides how and why
                your personal data is used and is the “data controller”. Address:{" "}
                <Placeholder>{LEGAL_DETAILS.operatorAddress}</Placeholder>. Privacy questions and
                requests: <Placeholder>{LEGAL_DETAILS.privacyEmail}</Placeholder>.
              </p>
              <p>
                Registration with the Office of the Data Protection Commissioner:{" "}
                <Placeholder>{LEGAL_DETAILS.registration}</Placeholder>
              </p>
            </>
          ),
        },
        {
          id: "what",
          title: "What we collect",
          body: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead>
                  <tr className="text-ink-muted">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Who
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      What
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Why
                    </th>
                  </tr>
                </thead>
                <tbody className="align-top">
                  <tr className="border-t border-sand">
                    <th scope="row" className="py-2 pr-4 font-normal">
                      Everyone with an account
                    </th>
                    <td className="py-2 pr-4">
                      Email address, name, password (stored only as a protected hash by our sign-in
                      provider), account type, the version of these documents you accepted.
                    </td>
                    <td className="py-2">To run your account and keep it secure.</td>
                  </tr>
                  <tr className="border-t border-sand">
                    <th scope="row" className="py-2 pr-4 font-normal">
                      Customers
                    </th>
                    <td className="py-2 pr-4">Creations you save (linked to your account).</td>
                    <td className="py-2">To show you your saved list.</td>
                  </tr>
                  <tr className="border-t border-sand">
                    <th scope="row" className="py-2 pr-4 font-normal">
                      Business owners
                    </th>
                    <td className="py-2 pr-4">
                      Business and owner name, description, county and town, website,{" "}
                      <strong>WhatsApp number (published)</strong>, logo and photographs, creations,
                      packages, your agreement to the seller terms, moderation decisions and
                      reasons, website help requests and replies.
                    </td>
                    <td className="py-2">To review and publish your business and to help you.</td>
                  </tr>
                  <tr className="border-t border-sand">
                    <th scope="row" className="py-2 pr-4 font-normal">
                      Invited business owners
                    </th>
                    <td className="py-2 pr-4">
                      The email address invited and the status of the invitation.
                    </td>
                    <td className="py-2">
                      To control who may register a business during the pilot.
                    </td>
                  </tr>
                  <tr className="border-t border-sand">
                    <th scope="row" className="py-2 pr-4 font-normal">
                      Visitors
                    </th>
                    <td className="py-2 pr-4">
                      Anonymous counts: which business or creation was viewed or had a contact link
                      opened, and when.{" "}
                      <strong>
                        No IP address, device details, account, phone number or message is stored
                        with these counts.
                      </strong>
                    </td>
                    <td className="py-2">To show businesses how many people looked.</td>
                  </tr>
                  <tr className="border-t border-sand">
                    <th scope="row" className="py-2 pr-4 font-normal">
                      Administrators
                    </th>
                    <td className="py-2 pr-4">
                      A record of actions taken (who, what, which record, when).
                    </td>
                    <td className="py-2">Accountability and security.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ),
        },
        {
          id: "whatsapp",
          title: "WhatsApp and other websites",
          body: (
            <p>
              <strong>Your WhatsApp messages never pass through KreateSpace.</strong> A contact
              button opens WhatsApp on your device with a message prepared from the creation or
              business you were looking at; you decide whether to send it. The quote form’s details
              are used only to prepare that message and are not stored by us. When you use WhatsApp
              or visit a business’s own website, that service’s own privacy policy applies.
            </p>
          ),
        },
        {
          id: "why",
          title: "Why we use your data, and on what basis",
          body: (
            <>
              <ul className="list-disc space-y-1 pl-6">
                <li>
                  <strong>To provide the service you asked for</strong> (account, saved list,
                  publishing your business) — because it is needed to carry out our agreement with
                  you.
                </li>
                <li>
                  <strong>To keep the service safe</strong> (preventing abuse, moderating content,
                  keeping records of administrators’ actions) — our legitimate interest, and
                  sometimes a legal duty.
                </li>
                <li>
                  <strong>To publish the details you choose to make public</strong> (your business
                  profile) — with your agreement when you submit it.
                </li>
                <li>
                  <strong>To email you</strong> about your account, invitations, and decisions on
                  your business — to run the service. We do not send marketing email.
                </li>
              </ul>
              <p>
                <Placeholder>
                  [Counsel to confirm the lawful basis for each purpose under the Data Protection
                  Act, 2019.]
                </Placeholder>
              </p>
              <p>
                We do not sell personal data, and we do not use it for advertising or profiling.
              </p>
            </>
          ),
        },
        {
          id: "storage",
          title: "Cookies and similar storage",
          body: (
            <p>
              We do not use advertising or analytics cookies. Your browser keeps your sign-in
              session so you stay logged in, and, briefly, a seller invitation you have opened or a
              creation you tried to save before logging in, so we can finish the action afterwards.
              These are removed when used or when you log out.
            </p>
          ),
        },
        {
          id: "sharing",
          title: "Who we share data with",
          body: (
            <>
              <p>
                Only the people and services needed to run KreateSpace. They process data on our
                instructions:
              </p>
              <ul className="list-disc space-y-1 pl-6">
                <li>Our database, sign-in and photo storage provider (Supabase).</li>
                <li>
                  Our website and server hosts (
                  <Placeholder>[providers — to be confirmed]</Placeholder>
                  ), which see technical request logs such as IP address and time.
                </li>
                <li>
                  Our email provider (<Placeholder>[provider — to be confirmed]</Placeholder>),
                  which handles the content and recipients of the emails we send.
                </li>
                <li>
                  If switched on, an error-reporting service. Reports are stripped of personal
                  details, passwords, tokens and messages before they leave our server.
                </li>
              </ul>
              <p>
                Your business profile is public by design. Our administrators can see account and
                business details they need to review applications. We may disclose data if the law
                requires it.
              </p>
            </>
          ),
        },
        {
          id: "transfers",
          title: "Data kept outside Kenya",
          body: (
            <p>
              Our providers may store or process data in other countries.{" "}
              <Placeholder>
                [Regions and safeguards — to be confirmed once providers and regions are chosen, and
                checked against the Act’s rules on transfers.]
              </Placeholder>
            </p>
          ),
        },
        {
          id: "retention",
          title: "How long we keep data",
          body: (
            <ul className="list-disc space-y-1 pl-6">
              <li>Account and profile data: until you ask us to delete your account.</li>
              <li>Anonymous view and click counts: {ANALYTICS_RETENTION_MONTHS} months.</li>
              <li>
                Invitations: expire after {INVITATION_VALID_DAYS} days; the record is kept to show
                who was invited.
              </li>
              <li>
                Records of administrators’ actions: kept for accountability, without your personal
                details once your account is deleted.
              </li>
              <li>
                Backups: copies of deleted data remain in backups until those expire, within{" "}
                <Placeholder>{LEGAL_DETAILS.backupRetention}</Placeholder>, and are not used for any
                other purpose.
              </li>
              <li>
                Anything the law requires us to keep, for as long as it requires.{" "}
                <Placeholder>[Counsel to list any such records.]</Placeholder>
              </li>
            </ul>
          ),
        },
        {
          id: "rights",
          title: "Your rights",
          body: (
            <>
              <p>You can ask us to:</p>
              <ul className="list-disc space-y-1 pl-6">
                <li>tell you what personal data we hold about you and give you a copy;</li>
                <li>
                  correct data that is wrong or incomplete (you can edit most of it yourself);
                </li>
                <li>delete your data;</li>
                <li>stop or limit using your data, or object to how we use it;</li>
                <li>give you your data in a commonly used format; and</li>
                <li>withdraw agreement you gave, without affecting what happened before.</li>
              </ul>
              <p>
                <strong>To delete your account,</strong> go to your account page and choose “Delete
                my account”. You will be asked to confirm with your password. We wait{" "}
                {DELETION_GRACE_DAYS} days so you can change your mind; you can cancel any time
                before then. A business owner’s request is also checked by an administrator, because
                it removes the business from KreateSpace. When it is carried out, your account,
                saved creations and, for business owners, the business and everything published or
                sent for it are permanently deleted.
              </p>
              <p>
                <strong>For anything else,</strong> including a copy of your data, email{" "}
                <Placeholder>{LEGAL_DETAILS.privacyEmail}</Placeholder>. We will check it is really
                you, and reply within{" "}
                <Placeholder>
                  [response time — owner to confirm; the Act sets time limits]
                </Placeholder>
                .
              </p>
            </>
          ),
        },
        {
          id: "security",
          title: "Keeping your data safe",
          body: (
            <p>
              Connections are encrypted. Passwords are never stored by us in readable form.
              Administrators need a second sign-in step. Photographs are stored privately, and
              unpublished work is never public. Access to data is limited to what each role needs.
              If a breach affects your data in a way that could harm you, we will tell you and the
              regulator as the law requires. No system is perfectly secure; choose a strong, unique
              password.
            </p>
          ),
        },
        {
          id: "children",
          title: "Children",
          body: (
            <p>
              KreateSpace is not meant for anyone under{" "}
              <Placeholder>{LEGAL_DETAILS.minimumAge}</Placeholder>. If you believe a child has
              given us data, tell us and we will delete it.
            </p>
          ),
        },
        {
          id: "complaints",
          title: "Complaints and changes",
          body: (
            <>
              <p>
                If you are unhappy with how we handle your data, tell us first at{" "}
                <Placeholder>{LEGAL_DETAILS.privacyEmail}</Placeholder>. You also have the right to
                complain to the Office of the Data Protection Commissioner in Kenya.
              </p>
              <p>
                We will post changes to this policy here and tell you about important ones. See also
                the{" "}
                <Link to="/terms" className="text-terracotta underline">
                  Terms of Use
                </Link>{" "}
                and{" "}
                <Link to="/seller-terms" className="text-terracotta underline">
                  Seller Terms
                </Link>
                .
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
