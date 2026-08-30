import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "reconcile expired work claims",
  { minutes: 5 },
  internal.domains.work.index.reconcileExpiredClaims,
  { limit: 100 },
);
crons.interval(
  "reconcile expired intake claims",
  { minutes: 5 },
  internal.domains.intake.index.reconcileExpiredClaims,
  { limit: 100 },
);
crons.interval(
  "reconcile expired upload reservations",
  { minutes: 15 },
  internal.domains.attachments.index.reconcileExpiredReservations,
  { limit: 100 },
);
crons.interval(
  "remove expired idempotency keys",
  { hours: 1 },
  internal.maintenance.removeExpiredIdempotencyKeys,
  { limit: 500 },
);
crons.interval(
  "remove expired gateway nonces",
  { minutes: 5 },
  internal.gateway.security.removeExpiredNonces,
  { limit: 1_000 },
);
crons.interval(
  "dispatch due notifications",
  { minutes: 1 },
  internal.domains.notifications.dispatcher.dispatchDue,
  { limit: 25 },
);

export default crons;
