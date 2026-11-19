/** This milestone deliberately cannot enable ordering through an environment flag. */
export const launchBlockers = Object.freeze([
  "Approved menu, prices, hours, capacity and tax rules are not installed.",
  "PostgreSQL application persistence and atomic reservations are not connected.",
  "Verified Stripe payments, reconciliation and transactional outbox are not connected.",
  "Staff authentication, authorization and secure guest tracking are not connected.",
  "Kitchen fulfillment and the physical printer have not been qualified.",
]);

export function getReadiness() {
  return {
    status: "not_ready" as const,
    mode: "development_foundation" as const,
    acceptingOrders: false,
    deliveryEnabled: false,
    currency: "CAD" as const,
    restaurantTimezone: "America/Toronto" as const,
    blockers: [...launchBlockers],
  };
}
