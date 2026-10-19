import type { DeletionEffects } from "../lib/account";

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * What deleting a business owner's account does to their business. The numbers come from the server,
 * so they match what an administrator sees when they review the request.
 */
export function BusinessImpact({
  business,
}: {
  business: NonNullable<DeletionEffects["business"]>;
}) {
  return (
    <div
      className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm"
      data-testid="business-impact"
    >
      <p className="font-medium">
        Your business{business.name ? ` “${business.name}”` : ""} will be removed too
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          Its public page (currently{" "}
          <strong>{business.status.toLowerCase().replace("_", " ")}</strong>) disappears from
          KreateSpace, and its address stops working.
        </li>
        <li>
          {business.creations === 0
            ? "It has no creations."
            : `${business.creations === 1 ? "Its 1 creation is" : `All ${business.creations} creations are`} deleted, including drafts and any waiting for review, with ${business.creations === 1 ? "its" : "their"} photos.`}
        </li>
        <li>
          {business.packages === 0
            ? "It has no service packages."
            : `${business.packages === 1 ? "Its 1 service package is" : `All ${business.packages} service packages are`} deleted, including any waiting for review.`}
        </li>
        <li>
          {business.openWebsiteRequests === 0
            ? "You have no open website requests. Past ones are deleted."
            : `${plural(business.openWebsiteRequests, "open website request")} will be deleted along with any past ones. Finish or cancel them first if you still need an answer.`}
        </li>
        <li>Analytics, imports and the history of the business are deleted.</li>
      </ul>
      {business.importInProgress ? (
        <p className="mt-2">A website import is running. Deletion waits until it has finished.</p>
      ) : null}
      <p className="mt-2">
        <strong>
          An administrator reviews every request from a business owner before anything happens.
        </strong>{" "}
        You will see their answer here.
      </p>
    </div>
  );
}
