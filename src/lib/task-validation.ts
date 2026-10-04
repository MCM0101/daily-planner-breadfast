export type Task = {
  id: string;
  title: string;
  day: string;
  comment: string;
  done: number;
  version: number;
  time?: string;
  source_id?: string;
  label?: string;
  labels?: string[];
  priority?: number;
  pending_from_date?: string;
};

export type Label = {
  id: string;
  name: string;
  createdAt: string;
  hasBeenUsed: boolean;
};
export function validTask(
  t: unknown,
): t is Omit<Task, "version"> & { version?: number } {
  if (!t || typeof t !== "object") return false;
  const x = t as Record<string, unknown>;
  if (
    typeof x.id !== "string" ||
    !x.id ||
    x.id.length > 80 ||
    x.id.includes("/") ||
    typeof x.title !== "string" ||
    !x.title.trim() ||
    x.title.length > 500 ||
    typeof x.comment !== "string" ||
    x.comment.length > 10000 ||
    ![0, 1].includes(x.done as number) ||
    typeof x.day !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(x.day)
  )
    return false;
  if (x.time !== undefined && typeof x.time !== "string") return false;
  if (x.time && !/^\d{1,2}:\d{2}$/.test(x.time)) return false;
  if (x.source_id !== undefined && typeof x.source_id !== "string") return false;
  if (x.label !== undefined && typeof x.label !== "string") return false;
  if (x.label && x.label.length > 80) return false;
  if (x.labels !== undefined) {
    if (
      !Array.isArray(x.labels) ||
      x.labels.length > 10 ||
      !x.labels.every(
        (l) => typeof l === "string" && l.length > 0 && l.length <= 80,
      )
    )
      return false;
  }
  if (x.priority !== undefined && ![0, 1].includes(x.priority as number))
    return false;
  if (
    x.pending_from_date !== undefined &&
    (typeof x.pending_from_date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(x.pending_from_date))
  )
    return false;
  const date = new Date(x.day + "T12:00:00");
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === x.day &&
    (x.version === undefined ||
      (Number.isInteger(x.version) && Number(x.version) > 0))
  );
}

export function validLabel(
  l: unknown,
): l is Omit<Label, "createdAt"> & { createdAt?: string } {
  if (!l || typeof l !== "object") return false;
  const x = l as Record<string, unknown>;
  if (
    typeof x.id !== "string" ||
    !x.id ||
    x.id.length > 80 ||
    x.id.includes("/") ||
    typeof x.name !== "string" ||
    !x.name.trim() ||
    x.name.length > 50 ||
    typeof x.hasBeenUsed !== "boolean"
  )
    return false;
  return true;
}
export function readBackup(input: unknown) {
  const rows = Array.isArray(input)
    ? input
    : input && typeof input === "object"
      ? (input as { tasks?: unknown }).tasks
      : null;
  if (!Array.isArray(rows) || rows.length > 10000 || !rows.every(validTask))
    throw Error(
      "Invalid backup: expected valid tasks with dates, comments, and status.",
    );
  if (new Set(rows.map((x) => x.id)).size !== rows.length)
    throw Error("The backup contains duplicate task IDs.");
  return rows;
}
