import {
  collection,
  doc,
  getDocsFromServer,
  getDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import { validTask, readBackup, type Task } from "./task-validation";

function taskCollection() {
  if (!db || !auth?.currentUser) throw Error("Sign in first.");
  return collection(db, "users", auth.currentUser.uid, "tasks");
}
function labelIdsOf(data: Record<string, unknown>): string[] {
  const arr = Array.isArray(data.labels) ? data.labels : [];
  const legacy = typeof data.label === "string" && data.label ? [data.label] : [];
  return [...new Set([...arr, ...legacy])] as string[];
}
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
/** Keeps the planner's response/error semantics while storing data directly in Firestore. */
export async function taskRequest(_url: string, options: RequestInit = {}) {
  try {
    if (!db || !auth?.currentUser) throw Error("Sign in first.");
    const ref = taskCollection();
    const dbNonNull = db;
    const userId = auth.currentUser.uid;
    if (!options.method || options.method === "GET") {
      const rows = await getDocsFromServer(ref);
      return reply({
        tasks: rows.docs
          .map((x) => {
            const data = x.data();
            const labels = labelIdsOf(data);
            delete data.label;
            delete data.reminder;
            return {
              ...data,
              ...(labels.length ? { labels } : {}),
            } as Record<string, unknown> & { id: string; day: string };
          })
          .sort(
            (a, b) => b.day.localeCompare(a.day) || a.id.localeCompare(b.id),
          ),
      });
    }
    const t = JSON.parse(String(options.body));
    if (options.method === "DELETE") {
      if (
        typeof t.id !== "string" ||
        !t.id ||
        t.id.includes("/") ||
        !Number.isInteger(t.version)
      )
        return reply({ error: "Invalid task" }, 400);
      const deletedTask = await runTransaction(dbNonNull, async (tx) => {
        const target = doc(ref, t.id);
        const current = await tx.get(target);
        if (!current.exists()) return { exists: false };
        if (current.data().version !== t.version)
          return { conflict: true };
        
        const taskData = current.data();
        tx.delete(target);
        return { exists: true, conflict: false, labels: labelIdsOf(taskData) };
      });
      
      if (!deletedTask.exists) {
        return reply({ deleted: true });
      }
      if (deletedTask.conflict) {
        return reply({ error: "Conflict" }, 409);
      }
      
      // Handle label cleanup after task is successfully deleted
      for (const labelId of deletedTask.labels || []) {
        try {
          // Check if this was the last task with this label (both new and legacy fields)
          const tasksWithLabel = await getDocsFromServer(
            query(ref, where("labels", "array-contains", labelId)),
          );
          const legacyTasks = await getDocsFromServer(
            query(ref, where("label", "==", labelId)),
          );
          if (tasksWithLabel.empty && legacyTasks.empty) {
            const labelRef = doc(dbNonNull, "users", userId, "labels", labelId);
            const labelDoc = await getDoc(labelRef);
            if (labelDoc.exists() && labelDoc.data().hasBeenUsed) {
              await deleteDoc(labelRef);
            }
          }
        } catch (e) {
          console.warn("Failed to cleanup label after task delete:", e);
          // Don't fail the delete operation if label cleanup fails
        }
      }
      
      return reply({ deleted: true });
    }
    if (options.method !== "POST" || !validTask(t)) {
      console.error("Invalid task received:", t);
      return reply({ error: "Invalid task" }, 400);
    }
    const result = await runTransaction(dbNonNull, async (tx) => {
      const target = doc(ref, t.id);
      const current = await tx.get(target);
      if (
        t.version &&
        (!current.exists() || current.data().version !== t.version)
      )
        return reply({ error: "Conflict" }, 409);
      if (!t.version && current.exists())
        return reply({ task: current.data() });
      const task: Task = {
        id: t.id,
        title: t.title.trim(),
        day: t.day,
        comment: t.comment,
        done: t.done,
        version: t.version ? t.version + 1 : 1,
        ...(t.time !== undefined && { time: t.time }),
        ...(t.source_id !== undefined && { source_id: t.source_id }),
        ...(labelIdsOf(t).length ? { labels: labelIdsOf(t) } : {}),
        ...(t.priority ? { priority: 1 } : {}),
        ...(t.pending_from_date !== undefined && {
          pending_from_date: t.pending_from_date,
        }),
      };
      tx.set(target, task);

      // Handle label marking as used and cleanup after the transaction completes
      const oldLabels = current.exists() ? labelIdsOf(current.data()) : [];
      const newLabels = task.labels || [];

      return { task, oldLabels, newLabels };
    });

    // Handle label cleanup after transaction completes
    if (result && typeof result === "object" && "task" in result) {
      const { task, oldLabels, newLabels } = result as {
        task: Task;
        oldLabels: string[];
        newLabels: string[];
      };
      
      // Mark newly assigned labels as used
      for (const labelId of newLabels) {
        if (oldLabels.includes(labelId)) continue;
        try {
          const labelRef = doc(dbNonNull, "users", userId, "labels", labelId);
          const labelDoc = await getDoc(labelRef);
          if (labelDoc.exists() && !labelDoc.data().hasBeenUsed) {
            await updateDoc(labelRef, { hasBeenUsed: true });
          }
        } catch (e) {
          console.warn("Failed to mark label as used:", e);
        }
      }

      // Clean up labels that were removed from this task and have no remaining tasks
      for (const labelId of oldLabels) {
        if (newLabels.includes(labelId)) continue;
        try {
          const tasksWithLabel = await getDocsFromServer(
            query(ref, where("labels", "array-contains", labelId)),
          );
          const legacyTasks = await getDocsFromServer(
            query(ref, where("label", "==", labelId)),
          );
          if (tasksWithLabel.empty && legacyTasks.empty) {
            const labelRef = doc(dbNonNull, "users", userId, "labels", labelId);
            const labelDoc = await getDoc(labelRef);
            if (labelDoc.exists() && labelDoc.data().hasBeenUsed) {
              await deleteDoc(labelRef);
            }
          }
        } catch (e) {
          console.warn("Failed to cleanup label:", e);
        }
      }

      return reply({ task });
    }

    return result;
  } catch (e) {
    console.error("Task operation failed", e);
    return reply(
      { error: "Storage unavailable. Check your connection and sign-in." },
      503,
    );
  }
}
/**
 * Moves every incomplete task scheduled before `today` (YYYY-MM-DD) to `today`.
 * Sets pending_from_date to the task's previous scheduled date on first
 * rollover and keeps it on subsequent runs. Transactional and idempotent:
 * each document is re-checked for incompleteness and overdue-ness before the
 * write, so a concurrent completion or reschedule wins. Returns the count
 * of tasks actually moved.
 */
export async function rolloverOverdueTasks(
  today: string,
  candidates?: { id: string; day: string; done: number }[],
): Promise<{ id: string; day: string; pending_from_date: string; version: number }[]> {
  if (!db || !auth?.currentUser) return [];
  const dbNonNull = db;
  const uid = auth.currentUser.uid;
  // Use the caller's already-loaded tasks as candidates when provided so no
  // extra server round-trip is needed to discover overdue tasks.
  const overdue = candidates
    ? candidates.filter((t) => !t.done && typeof t.day === "string" && t.day < today)
    : (
        await getDocsFromServer(
          query(taskCollection(), where("day", "<", today)),
        )
      ).docs.map((s) => ({ id: s.id, ...(s.data() as { day?: string; done?: number }) }));
  const moved = await Promise.all(
    overdue.map(async (t) => {
      try {
        const ref = doc(dbNonNull, "users", uid, "tasks", t.id);
        return await runTransaction(dbNonNull, async (tx) => {
          const cur = await tx.get(ref);
          if (!cur.exists()) return null;
          const d = cur.data();
          // Re-check inside the transaction: still incomplete, still overdue.
          if (d.done || typeof d.day !== "string" || d.day >= today) return null;
          const pending =
            typeof d.pending_from_date === "string" && d.pending_from_date
              ? d.pending_from_date
              : d.day;
          const version = (d.version || 1) + 1;
          // Drop the leftover email-reminder field while rewriting the doc.
          const { reminder: _oldReminder, ...rest } = d;
          tx.set(ref, { ...rest, day: today, pending_from_date: pending, version });
          return { id: ref.id, day: today, pending_from_date: pending, version };
        });
      } catch (e) {
        console.warn("Rollover failed for task", t.id, e);
        return null;
      }
    }),
  );
  return moved.filter((m): m is NonNullable<typeof m> => m !== null);
}
export async function restoreBackup(
  input: unknown,
  onProgress: (done: number, total: number) => void,
) {
  if (!db || !auth?.currentUser) throw Error("Sign in first.");
  const dbNonNull = db;
  const userId = auth.currentUser.uid;
  const rows = readBackup(input);
  let imported = 0,
    skipped = 0;
  // Each create is atomic. Existing IDs are preserved, making interrupted imports safe to retry.
  for (const t of rows) {
    const result = await runTransaction(dbNonNull, async (tx) => {
      const target = doc(taskCollection(), t.id);
      const exists = await tx.get(target);
      if (exists.exists()) return false;
      tx.set(target, {
        id: t.id,
        title: t.title,
        day: t.day,
        comment: t.comment,
        done: t.done,
        version: 1,
        ...(t.time !== undefined && { time: t.time }),
        ...(t.source_id !== undefined && { source_id: t.source_id }),
        ...(labelIdsOf(t).length ? { labels: labelIdsOf(t) } : {}),
        ...(t.priority ? { priority: 1 } : {}),
        ...(t.pending_from_date !== undefined && {
          pending_from_date: t.pending_from_date,
        }),
      });

      // Mark labels as used if this is the first task with them
      for (const labelId of labelIdsOf(t)) {
        const labelRef = doc(dbNonNull, "users", userId, "labels", labelId);
        const labelDoc = await tx.get(labelRef);
        if (labelDoc.exists() && !labelDoc.data().hasBeenUsed) {
          tx.update(labelRef, { hasBeenUsed: true });
        }
      }

      return true;
    });
    if (result) imported++;
    else skipped++;
    onProgress(imported + skipped, rows.length);
  }
  return { imported, skipped };
}
