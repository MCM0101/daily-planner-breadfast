const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();

// Runs once per day just after midnight in the configured timezone.
// Moves every incomplete task scheduled before today to today and records
// the first rollover date in pending_from_date.
exports.rolloverPendingTasks = onSchedule(
  {
    schedule: "every day 00:10",
    timeZone: "Africa/Cairo",
    retryCount: 2,
  },
  async () => {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const db = admin.firestore();
    // listDocuments() returns references for every users/{uid} path,
    // including docs that only exist as subcollection parents.
    const userRefs = await db.collection("users").listDocuments();
    let moved = 0;

    for (const userRef of userRefs) {
      const overdue = await userRef
        .collection("tasks")
        .where("day", "<", today)
        .where("done", "==", 0)
        .get();

      for (const snap of overdue.docs) {
        // Re-check inside a transaction so a concurrent completion or
        // reschedule wins and repeated runs stay idempotent.
        const ok = await db.runTransaction(async (tx) => {
          const cur = await tx.get(snap.ref);
          if (!cur.exists) return false;
          const d = cur.data();
          if (d.done || typeof d.day !== "string" || d.day >= today)
            return false;
          tx.set(snap.ref, {
            ...d,
            day: today,
            pending_from_date:
              typeof d.pending_from_date === "string" && d.pending_from_date
                ? d.pending_from_date
                : d.day,
            version: (d.version || 1) + 1,
          });
          return true;
        });
        if (ok) moved++;
      }
    }

    console.log(`Rollover complete for ${today}: moved ${moved} task(s)`);
  },
);
