import { taskRequest, rolloverOverdueTasks } from "../lib/task-store";
import { getLabels, createLabel, deleteLabel } from "../lib/label-store";
import { useState, useEffect, useRef } from "react";
import {
  Check,
  Plus,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Pencil,
  X,
  Trash2,
  Download,
  Search,
  ChevronDown,
  Tag,
  Plus as PlusIcon,
} from "lucide-react";
type Task = {
  id: string;
  title: string;
  day: string;
  comment: string;
  done: number;
  version: number;
  time?: string;
  label?: string;
  labels?: string[];
  priority?: number;
  pending_from_date?: string;
};

type Label = {
  id: string;
  name: string;
  createdAt: string;
  hasBeenUsed: boolean;
};
const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const pretty = (s: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(s + "T12:00:00").toLocaleDateString("en-US", opts);
const formatTime = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;
};
const taskLabelIds = (t: Task): string[] =>
  t.labels?.length ? t.labels : t.label ? [t.label] : [];
// Rollover boundary uses the Africa/Cairo calendar date (DST-aware via Intl).
const cairoToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const pendingTip = (t: Task) =>
  `This task is pending from date ${pretty(t.pending_from_date!, {
    day: "numeric",
    month: "long",
    year: "numeric",
  })}`;
let sharedAudio: AudioContext | null = null;
const getAudioCtx = () => {
  if (!sharedAudio) {
    sharedAudio = new (window.AudioContext ||
      (window as any).webkitAudioContext)();
  }
  return sharedAudio;
};
export default function Home() {
  const [today] = useState(() => dateKey(new Date()));
  const [month, setMonth] = useState(() => dateKey(new Date()).slice(0, 7));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(today);
  const [time, setTime] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [view, setView] = useState<"day" | "month" | "label" | "priority" | "pending">("day");
  const [drafts, setDrafts] = useState<
    Record<string, { comment: string; version: number }>
  >({});
  const [deleting, setDeleting] = useState<string | null>(null);
  const [exportScope, setExportScope] = useState("month");
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState("");
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("default");
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [labels, setLabels] = useState<Label[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [quickLabelIds, setQuickLabelIds] = useState<string[]>([]);
  const [showQuickLabels, setShowQuickLabels] = useState(false);
  const [showNewLabelModal, setShowNewLabelModal] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [labelError, setLabelError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [labelPickerFor, setLabelPickerFor] = useState<string | null>(null);
  const [labelQuery, setLabelQuery] = useState("");
  const [editLabelsOpen, setEditLabelsOpen] = useState(false);
  const [labelsSectionOpen, setLabelsSectionOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMsg, setSaveMsg] = useState("");
  const tasksRef = useRef<Task[]>([]);
  tasksRef.current = tasks;
  const editingRef = useRef<Task | null>(null);
  editingRef.current = editing;
  const editDirty = useRef<Set<keyof Task>>(new Set());
  const queuedTask = useRef<Task | null>(null);
  const saveDrain = useRef<Promise<void> | null>(null);
  const saveFailed = useRef(false);
  const composing = useRef(false);
  const autosaveTimer = useRef(0);

  function queueAutosave(task?: Task) {
    const t = task ?? editingRef.current;
    if (!t) return;
    queuedTask.current = t;
    if (!saveDrain.current) {
      saveDrain.current = drainAutosave().finally(() => {
        saveDrain.current = null;
      });
    }
  }
  // Serializes autosaves so an older, slower request can never overwrite a
  // newer edit, and merges only dirty fields onto the freshest known task.
  async function drainAutosave() {
    while (queuedTask.current) {
      const next = queuedTask.current;
      queuedTask.current = null;
      if (!next.title.trim()) {
        saveFailed.current = true;
        setSaveState("error");
        setSaveMsg("Add a title to save this task.");
        continue;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(next.day)) {
        saveFailed.current = true;
        setSaveState("error");
        setSaveMsg("Pick a valid date to save.");
        continue;
      }
      const base = tasksRef.current.find((x) => x.id === next.id);
      const dirty = [...editDirty.current];
      const payload: Task = { ...(base ?? next) } as Task;
      for (const f of dirty) {
        (payload as Record<string, unknown>)[f] = next[f];
      }
      payload.id = next.id;
      payload.version = Math.max(base?.version ?? 0, next.version);
      setSaveState("saving");
      try {
        const r = await taskRequest("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          if (r.status === 409) {
            await refresh();
            queuedTask.current = editingRef.current ?? next;
            continue;
          }
          throw Error("Couldn't save your latest changes.");
        }
        const saved = (await r.json()).task as Task;
        setTasks((old) => old.map((x) => (x.id === saved.id ? saved : x)));
        for (const f of dirty) {
          if (editingRef.current?.[f] === payload[f as keyof Task])
            editDirty.current.delete(f);
        }
        setEditing((prev) =>
          prev && prev.id === saved.id ? { ...prev, version: saved.version } : prev,
        );
        saveFailed.current = false;
        setSaveState("saved");
        setSaveMsg("");
      } catch (e) {
        saveFailed.current = true;
        setSaveState("error");
        setSaveMsg((e as Error).message || "Couldn't save your latest changes.");
        break;
      }
    }
  }
  function applyEdit(patch: Partial<Task>) {
    const cur = editingRef.current;
    if (!cur) return;
    const next = { ...cur, ...patch };
    for (const k of Object.keys(patch)) editDirty.current.add(k as keyof Task);
    setEditing(next);
    queueAutosave(next);
  }
  function scheduleTextAutosave() {
    window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => queueAutosave(), 900);
  }
  function onEditText(field: "title" | "comment", value: string) {
    const cur = editingRef.current;
    if (!cur) return;
    const next = { ...cur, [field]: value };
    editDirty.current.add(field);
    setEditing(next);
    if (!composing.current) scheduleTextAutosave();
  }
  function flushTextAutosave() {
    window.clearTimeout(autosaveTimer.current);
    queueAutosave();
  }
  function openEditor(t: Task) {
    window.clearTimeout(autosaveTimer.current);
    editDirty.current = new Set();
    saveFailed.current = false;
    queuedTask.current = null;
    setSaveState("idle");
    setSaveMsg("");
    setLabelQuery("");
    setEditLabelsOpen(false);
    setLabelPickerFor(null);
    setEditing({ ...t });
  }
  async function closeEditor() {
    window.clearTimeout(autosaveTimer.current);
    if (editingRef.current && editDirty.current.size) queueAutosave();
    while (saveDrain.current) await saveDrain.current;
    if (saveFailed.current) return; // keep the editor open with the error visible
    setEditing(null);
    setSaveState("idle");
    setSaveMsg("");
    setEditLabelsOpen(false);
  }
  // Close the card label popover on outside interaction.
  useEffect(() => {
    if (!labelPickerFor) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".task-labels-slot"))
        setLabelPickerFor(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [labelPickerFor]);
  function applyRollover(
    list: Task[],
    moved: { id: string; day: string; pending_from_date: string; version: number }[],
  ) {
    const byId = new Map(moved.map((m) => [m.id, m]));
    return list.map((t) => {
      const m = byId.get(t.id);
      return m
        ? { ...t, day: m.day, pending_from_date: m.pending_from_date, version: m.version }
        : t;
    });
  }
  async function refresh() {
    setLoading(true);
    try {
      const r = await taskRequest("/api/tasks");
      if (!r.ok) throw Error();
      const list: Task[] = (await r.json()).tasks;
      // Roll over overdue tasks found in the just-fetched list — one server
      // fetch plus parallel transactions, no extra round-trips.
      const moved = await rolloverOverdueTasks(cairoToday(), list);
      setTasks(applyRollover(list, moved));
      if (moved.length)
        setStatus(
          `${moved.length} task${moved.length === 1 ? "" : "s"} rolled over to today`,
        );
      setError("");
    } catch {
      setError("Your tasks could not be loaded. Please retry.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  const lastRolloverDay = useRef("");
  async function reconcileRollover() {
    try {
      const moved = await rolloverOverdueTasks(cairoToday(), tasksRef.current);
      if (moved.length) {
        setTasks((cur) => applyRollover(cur, moved));
        setStatus(
          `${moved.length} task${moved.length === 1 ? "" : "s"} rolled over to today`,
        );
      }
    } catch (e) {
      console.warn("Rollover reconciliation failed:", e);
    }
  }
  useEffect(() => {
    lastRolloverDay.current = cairoToday();
    reconcileRollover();
    const checkMidnight = () => {
      const d = cairoToday();
      if (d !== lastRolloverDay.current) {
        lastRolloverDay.current = d;
        reconcileRollover();
      }
    };
    const interval = setInterval(checkMidnight, 60000);
    const onWake = () => {
      if (!document.hidden) {
        checkMidnight();
        reconcileRollover();
      }
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, []);

  useEffect(() => {
    loadLabels();
  }, []);

  async function loadLabels() {
    try {
      const loadedLabels = await getLabels();
      setLabels(loadedLabels);
    } catch (e) {
      console.error("Failed to load labels:", e);
    }
  }

  // Resolves a task's label IDs to labels that still exist
  const taskLabels = (t: Task): Label[] =>
    taskLabelIds(t)
      .map((id) => labels.find((l) => l.id === id))
      .filter((l): l is Label => !!l);

  const newLabelForTask = useRef<string | null>(null);
  async function handleCreateLabel() {
    setLabelError("");
    try {
      const label = await createLabel(newLabelName);
      setLabels((prev) => [...prev, label]);
      // Auto-select the new label in whichever form is open
      if (editingRef.current) {
        applyEdit({
          labels: [...new Set([...taskLabelIds(editingRef.current), label.id])],
          label: undefined,
        });
      } else if (newLabelForTask.current) {
        const t = tasksRef.current.find((x) => x.id === newLabelForTask.current);
        if (t) {
          await save({
            ...t,
            labels: [...new Set([...taskLabelIds(t), label.id])],
            label: undefined,
          });
        }
        newLabelForTask.current = null;
      } else {
        setQuickLabelIds((prev) => [...new Set([...prev, label.id])]);
      }
      setNewLabelName("");
      setShowNewLabelModal(false);
      setStatus("Label created");
    } catch (e) {
      setLabelError((e as Error).message);
    }
  }

  useEffect(() => {
    if ("Notification" in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    if (notificationPermission !== "granted") return;

    const notifiedTasks = new Set<string>();

    const checkAndScheduleNotifications = () => {
      const now = new Date();
      const upcomingTasks = tasks.filter((t) => {
        if (!t.time || t.done) return false;
        const taskDate = new Date(t.day + "T" + t.time);
        const timeDiff = taskDate.getTime() - now.getTime();
        return timeDiff > 0 && timeDiff <= 10 * 60 * 1000; // Within 10 minutes
      });

      upcomingTasks.forEach((task) => {
        const taskDate = new Date(task.day + "T" + task.time);
        const notificationTime = new Date(taskDate.getTime() - 10 * 60 * 1000);
        const timeUntilNotification = notificationTime.getTime() - now.getTime();

        // Check if we should notify now (within 1 minute of notification time)
        if (timeUntilNotification <= 60000 && timeUntilNotification > 0 && !notifiedTasks.has(task.id)) {
          notifiedTasks.add(task.id);
          setTimeout(() => {
            playNotificationSound();
            new Notification("Daybook Reminder", {
              body: `Task "${task.title}" is coming up in 10 minutes`,
              icon: "/favicon.svg",
              requireInteraction: true,
            });
          }, timeUntilNotification);
        }
      });
    };

    checkAndScheduleNotifications();
    const interval = setInterval(checkAndScheduleNotifications, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [tasks, notificationPermission]);

  async function requestNotificationPermission() {
    if (!("Notification" in window)) {
      setError("This browser does not support notifications");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === "granted") {
      setStatus("Notifications enabled");
    } else {
      setError("Notification permission denied");
    }
  }

  async function playTone(
    frequency: number,
    duration: number,
    peak = 0.3,
    type: OscillatorType = "sine",
  ) {
    try {
      const ctx = getAudioCtx();
      if (ctx.state === "suspended") await ctx.resume();
      if (ctx.state !== "running") return;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.frequency.value = frequency;
      oscillator.type = type;
      gainNode.gain.setValueAtTime(peak, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + duration);
    } catch {
      /* audio unavailable */
    }
  }

  function playNotificationSound() {
    playTone(800, 0.5);
  }

  function playTaskCompleteSound() {
    playTone(523.25, 0.3, 0.2); // C5 note
  }

  async function playFireSound() {
    try {
      const ctx = getAudioCtx();
      if (ctx.state === "suspended") await ctx.resume();
      if (ctx.state !== "running") return;
      const duration = 0.6;
      const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(2200, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(280, ctx.currentTime + duration);
      filter.Q.value = 1.1;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start(ctx.currentTime);
      src.stop(ctx.currentTime + duration);
    } catch {
      /* audio unavailable */
    }
  }
  async function save(task: Partial<Task>) {
    setBusy(true);
    setError("");
    setStatus("Saving…");
    try {
      const r = await taskRequest("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(task),
      });
      if (!r.ok) {
        if (r.status === 409) {
          await refresh();
          throw Error(
            "This task changed in another window. Reopen it to edit the latest version.",
          );
        }
        throw Error(
          "Could not save. Your input is still here; please try again.",
        );
      }
      const t = (await r.json()).task;
      setTasks((old) => [...old.filter((x) => x.id !== t.id), t]);
      setStatus("All changes saved");
      return true;
    } catch (e) {
      setError((e as Error).message);
      setStatus("Changes not saved");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function removeTask(task: Task) {
    setBusy(true);
    setError("");
    try {
      const r = await taskRequest("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, version: task.version }),
      });
      if (!r.ok) {
        const errorText = await r.text();
        console.error("Delete task error response:", r.status, errorText);
        if (r.status === 409) {
          await refresh();
          throw Error(
            "This task was changed elsewhere. Review the latest version before deleting.",
          );
        }
        throw Error("Could not delete. Please try again.");
      }
      setTasks((old) => old.filter((t) => t.id !== task.id));
      setDrafts((old) => {
        const next = { ...old };
        delete next[task.id];
        return next;
      });
      setDeleting(null);
      setStatus("Task deleted");
    } catch (e) {
      console.error("Delete task error:", e);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveComment(t: Task) {
    const draft = drafts[t.id];
    if (!draft) return;
    if (await save({ ...t, comment: draft.comment, version: draft.version })) {
      setDrafts((old) => {
        const next = { ...old };
        delete next[t.id];
        return next;
      });
    }
  }
  const unsaved = Object.keys(drafts).length;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
  async function exportPdf() {
    setExporting(true);
    setError("");
    try {
      const r = await taskRequest("/api/tasks");
      if (!r.ok) throw Error();
      const fresh = (await r.json()).tasks as Task[];
      const selected = fresh.filter(
        (t) =>
          exportScope === "all" ||
          (exportScope === "day" ? t.day === day : t.day.startsWith(month)),
      );
      const label =
        exportScope === "all"
          ? "All dates"
          : exportScope === "day"
            ? pretty(day, { day: "numeric", month: "long", year: "numeric" })
            : pretty(month + "-01", { month: "long", year: "numeric" });
      const { downloadPlannerPdf } = await import("../lib/export-pdf");
      downloadPlannerPdf(
        selected,
        label,
        "daybook-" +
          (exportScope === "all"
            ? "all-dates"
            : exportScope === "day"
              ? day
              : month) +
          ".pdf",
      );
      setStatus("PDF exported");
    } catch {
      setError("Could not export the PDF. Please try again.");
    } finally {
      setExporting(false);
    }
  }
  function selectDay(value: string) {
    if (!value) return;
    setDay(value);
    setMonth(value.slice(0, 7));
  }
  function changeDay(n: number) {
    const d = new Date(day + "T12:00:00");
    d.setDate(d.getDate() + n);
    selectDay(dateKey(d));
    setView("day");
  }

  async function pushTask(task: Task, days: number) {
    const d = new Date(task.day + "T12:00:00");
    d.setDate(d.getDate() + days);
    const newDay = dateKey(d);
    const success = await save({ ...task, day: newDay });
    if (success) {
      setStatus(`Task moved to ${newDay}`);
      if (view === "day") {
        setMonth(newDay.slice(0, 7));
      }
    }
  }
  function toggleTaskSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }
  function clearSelection() {
    setSelectedIds([]);
  }
  async function batchPush(daysToShift: number) {
    const selected = tasks.filter((t) => selectedIds.includes(t.id));
    if (!selected.length) return;
    setBusy(true);
    setError("");
    let failed = 0;
    for (const t of selected) {
      const d = new Date(t.day + "T12:00:00");
      d.setDate(d.getDate() + daysToShift);
      const newDay = dateKey(d);
      const r = await taskRequest("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...t, day: newDay }),
      });
      if (r.ok) {
        setTasks((old) =>
          old.map((x) =>
            x.id === t.id ? { ...x, day: newDay, version: x.version + 1 } : x,
          ),
        );
      } else {
        failed++;
      }
    }
    setBusy(false);
    setSelectedIds([]);
    const moved = selected.length - failed;
    setStatus(
      failed
        ? `Moved ${moved} task${moved === 1 ? "" : "s"}`
        : `Moved ${moved} task${moved === 1 ? "" : "s"}`,
    );
    if (failed) setError(`${failed} task${failed === 1 ? "" : "s"} could not be moved.`);
  }
  async function batchDelete() {
    const selected = tasks.filter((t) => selectedIds.includes(t.id));
    if (!selected.length) return;
    if (!window.confirm(`Delete ${selected.length} task${selected.length === 1 ? "" : "s"}? This cannot be undone.`))
      return;
    setBusy(true);
    setError("");
    let failed = 0;
    for (const t of selected) {
      const r = await taskRequest("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, version: t.version }),
      });
      if (r.ok) {
        setTasks((old) => old.filter((x) => x.id !== t.id));
        setDrafts((old) => {
          const next = { ...old };
          delete next[t.id];
          return next;
        });
      } else {
        failed++;
      }
    }
    setBusy(false);
    setSelectedIds([]);
    const deleted = selected.length - failed;
    setStatus(`Deleted ${deleted} task${deleted === 1 ? "" : "s"}`);
    if (failed) setError(`${failed} task${failed === 1 ? "" : "s"} could not be deleted.`);
  }
  function changeMonth(n: number) {
    const d = new Date(month + "-01T12:00:00");
    d.setMonth(d.getMonth() + n);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(Number(day.slice(-2)), end));
    selectDay(dateKey(d));
  }

  function sortTasksForDay(dayTasks: Task[]): Task[] {
    const hasTimedTasks = dayTasks.some((t) => t.time);
    const priorityFirst = (a: Task, b: Task) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0);

    if (hasTimedTasks) {
      // Primary mode: sort by time, priority always on top
      return [...dayTasks].sort((a, b) => {
        const p = priorityFirst(a, b);
        if (p) return p;
        if (a.time && b.time) return a.time.localeCompare(b.time);
        if (a.time) return -1;
        if (b.time) return 1;
        return a.id.localeCompare(b.id);
      });
    } else {
      // Fallback mode: sort by completion status, priority always on top
      return [...dayTasks].sort((a, b) => {
        const p = priorityFirst(a, b);
        if (p) return p;
        if (a.done !== b.done) return a.done - b.done;
        return a.id.localeCompare(b.id);
      });
    }
  }
  // Shared label menu used by the card popover and the task-details selector.
  function renderLabelMenu(
    currentIds: string[],
    onToggle: (id: string) => void,
    onClear: () => void,
    onCreate: () => void,
    onClose: () => void,
  ) {
    const q = labelQuery.trim().toLowerCase();
    const shown = labels.filter(
      (l) => !q || l.name.toLowerCase().includes(q),
    );
    const moveFocus = (e: React.KeyboardEvent, dir: 1 | -1) => {
      const items = Array.from(
        e.currentTarget
          .closest(".label-menu")!
          .querySelectorAll<HTMLElement>(".label-menu-option"),
      );
      const i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + dir + items.length) % items.length]?.focus();
      e.preventDefault();
    };
    return (
      <div
        className="label-menu"
        role="menu"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
          if (e.key === "ArrowDown") moveFocus(e, 1);
          if (e.key === "ArrowUp") moveFocus(e, -1);
        }}
      >
        <input
          className="label-menu-search"
          type="search"
          placeholder="Search labels…"
          aria-label="Search labels"
          value={labelQuery}
          onChange={(e) => setLabelQuery(e.target.value)}
        />
        <div className="label-menu-list" role="group" aria-label="Labels">
          {shown.map((l) => {
            const on = currentIds.includes(l.id);
            return (
              <button
                key={l.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                className={"label-menu-option" + (on ? " on" : "")}
                onClick={() => onToggle(l.id)}
              >
                <span className="label-menu-name">{l.name}</span>
                <span className="label-menu-check">
                  {on && <Check size={13} strokeWidth={3} />}
                </span>
              </button>
            );
          })}
          {!shown.length && (
            <div className="label-menu-none">No matching labels</div>
          )}
        </div>
        {currentIds.length > 0 && (
          <button type="button" className="label-menu-clear" onClick={onClear}>
            Remove all labels
          </button>
        )}
        <button
          type="button"
          className="label-picker-new"
          onClick={onCreate}
        >
          <PlusIcon size={14} />
          Create new label
        </button>
      </div>
    );
  }

  function renderTaskRow(t: Task) {
    const tl = taskLabels(t);
    const ids = taskLabelIds(t);
    const pending = !t.done && !!t.pending_from_date;
    const selected = selectedIds.includes(t.id);
    return (
      <div
        className={
          "task-row " +
          (t.done ? "task-done " : "") +
          (t.priority ? "task-priority " : "") +
          (selected ? "task-row-selected" : "")
        }
        key={t.id}
      >
        <div className="task-main">
          <button
            className={"select-box" + (selected ? " selected" : "")}
            aria-label={"Select " + t.title}
            aria-pressed={selected}
            title="Select for batch actions"
            onClick={() => toggleTaskSelect(t.id)}
          >
            {selected && <Check size={11} strokeWidth={3.5} />}
          </button>
          <div className="task-check-col">
            <label className="done-toggle">
              <input
                type="checkbox"
                aria-label={
                  "Mark " + t.title + (t.done ? " incomplete" : " complete")
                }
                checked={!!t.done}
                disabled={busy || !!drafts[t.id]}
                onChange={async () => {
                  const wasDone = !!t.done;
                  getAudioCtx().resume(); // unlock audio within the click gesture
                  const success = await save({ ...t, done: t.done ? 0 : 1 });
                  if (success && !wasDone) {
                    if (t.priority) playFireSound();
                    else playTaskCompleteSound();
                  } else if (success) {
                    void reconcileRollover();
                  }
                }}
              />
              <span className="done-tick" aria-hidden="true">
                <Check size={20} strokeWidth={3} />
              </span>
            </label>
            <button
              className={"priority-btn" + (t.priority ? " active" : "")}
              aria-label={
                (t.priority ? "Remove priority from " : "Mark priority on ") +
                t.title
              }
              aria-pressed={!!t.priority}
              title={t.priority ? "Remove priority" : "Mark as priority"}
              disabled={busy || !!drafts[t.id]}
              onClick={() => save({ ...t, priority: t.priority ? 0 : 1 })}
            >
              🔥
            </button>
          </div>
          <div className="task-content">
            <button
              className="task-title"
              disabled={busy || !!drafts[t.id]}
              onClick={() => openEditor(t)}
            >
              <span className="task-title-text">{t.title}</span>
              <Pencil size={14} />
            </button>
            {(t.time || pending) && (
              <div className="task-meta">
                {t.time && (
                  <span className="task-time">{formatTime(t.time)}</span>
                )}
                {pending && (
                  <span className="pending-since">
                    Pending since{" "}
                    {pretty(t.pending_from_date!, {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="task-side">
            <div className="task-labels-slot">
              {tl.length ? (
                tl.map((label) => (
                <button
                  key={label.id}
                  type="button"
                  className="task-label"
                  title={label.name}
                  aria-label={`Label ${label.name}. Change labels for ${t.title}`}
                  disabled={busy}
                  onClick={() => {
                    setLabelQuery("");
                    setLabelPickerFor(labelPickerFor === t.id ? null : t.id);
                  }}
                >
                  <Tag size={11} />
                  <span className="task-label-name">{label.name}</span>
                </button>
              ))
            ) : (
              <button
                type="button"
                className="task-label-empty tip tip-center"
                aria-label={"Add label to " + t.title}
                data-tip="Add a label"
                disabled={busy}
                onClick={() => {
                  setLabelQuery("");
                  setLabelPickerFor(labelPickerFor === t.id ? null : t.id);
                }}
              >
                <PlusIcon size={12} />
              </button>
            )}
            {labelPickerFor === t.id &&
              renderLabelMenu(
                ids,
                (id) => {
                  const next = ids.includes(id)
                    ? ids.filter((x) => x !== id)
                    : [...ids, id];
                  save({
                    ...t,
                    labels: next.length ? next : undefined,
                    label: undefined,
                  });
                },
                () => save({ ...t, labels: undefined, label: undefined }),
                () => {
                  newLabelForTask.current = t.id;
                  setLabelPickerFor(null);
                  setShowNewLabelModal(true);
                },
                () => setLabelPickerFor(null),
              )}
          </div>
          <div className="task-row-actions">
            <button
              className="icon-btn tip"
              aria-label={"Push " + t.title + " to yesterday"}
              data-tip="Push this task yesterday"
              disabled={busy || !!drafts[t.id]}
              onClick={() => pushTask(t, -1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="icon-btn tip"
              aria-label={"Push " + t.title + " to tomorrow"}
              data-tip="Push this task tomorrow"
              disabled={busy || !!drafts[t.id]}
              onClick={() => pushTask(t, 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          </div>
          <div className="task-status">
            {pending && (
              <button
                type="button"
                className="pending-warn"
                title={pendingTip(t)}
                aria-label={pendingTip(t)}
                data-tip={pendingTip(t)}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                !
              </button>
            )}
          </div>
        </div>
        <div className="inline-comment">
          <textarea
            aria-label={"Comment for " + t.title}
            rows={2}
            maxLength={10000}
            placeholder="Write an update…"
            disabled={busy}
            value={drafts[t.id]?.comment ?? t.comment}
            onChange={(e) => {
              const value = e.target.value;
              setDrafts((old) => {
                const next = { ...old };
                if (value === t.comment) delete next[t.id];
                else
                  next[t.id] = {
                    comment: value,
                    version: old[t.id]?.version ?? t.version,
                  };
                return next;
              });
            }}
          />
          <div className="row-actions">
            {drafts[t.id] && (
              <>
                <button
                  className="save-comment"
                  disabled={busy || drafts[t.id].version !== t.version}
                  onClick={() => saveComment(t)}
                >
                  Save comment
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    setDrafts((old) => {
                      const next = { ...old };
                      delete next[t.id];
                      return next;
                    })
                  }
                >
                  Discard edit
                </button>
              </>
            )}
            {deleting === t.id ? (
              <span className="delete-confirm">
                Delete task?
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => removeTask(t)}
                >
                  Delete
                </button>
                <button disabled={busy} onClick={() => setDeleting(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button
                className="delete-task"
                aria-label={"Delete " + t.title}
                disabled={busy}
                onClick={() => setDeleting(t.id)}
              >
                <Trash2 size={15} />
                <span>Delete</span>
              </button>
            )}
          </div>
          {drafts[t.id] && drafts[t.id].version !== t.version && (
            <div className="comment-conflict" role="alert">
              This task changed elsewhere. Your draft is above. Saved comment:{" "}
              {t.comment || "(empty)"}
              <button
                onClick={() =>
                  setDrafts((old) => ({
                    ...old,
                    [t.id]: {
                      ...old[t.id],
                      version: t.version,
                    },
                  }))
                }
              >
                Keep my draft for this version
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
  const monthLength = new Date(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)),
    0,
  ).getDate();
  const calendarDays = Array.from(
    { length: monthLength },
    (_, i) => month + "-" + String(i + 1).padStart(2, "0"),
  );
  useEffect(() => {
    document
      .getElementById("date-" + day)
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [day, month, view]);
  const visible = tasks.filter((t) => t.day.startsWith(month));
  const searching = !!query.trim();
  const matching = searching
    ? tasks.filter((t) =>
        (t.title + " " + t.comment)
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      )
    : visible;
  const resultDays = [...new Set(matching.map((t) => t.day))].sort().reverse();
  const days = [
    ...new Set([
      ...visible.map((t) => t.day),
      ...(today.startsWith(month) ? [today] : []),
    ]),
  ]
    .sort()
    .reverse();
  const completed = visible.filter((t) => t.done).length;
  const completeDays = days.filter(
    (d) =>
      visible.some((t) => t.day === d) &&
      visible.filter((t) => t.day === d).every((t) => t.done),
  ).length;
  const pendingCount = tasks.filter((t) => !t.done && t.pending_from_date).length;
  const selectableTasks =
    view === "priority"
      ? tasks.filter((t) => t.priority)
      : view === "pending"
        ? tasks.filter((t) => !t.done && t.pending_from_date)
        : view === "label" && selectedLabelIds.length
        ? tasks.filter((t) =>
            taskLabelIds(t).some((id) => selectedLabelIds.includes(id)),
          )
        : searching
          ? matching
          : view === "day"
            ? matching.filter((t) => t.day === day)
            : matching;
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/">
          <span className="brand-icon">
            <BookOpen size={22} />
          </span>
          daybook<span className="brand-dot">.</span>
        </a>
        <div className="sidebar-caption">YOUR WORKSPACE</div>
        <div className={`nav-item ${view === "day" && selectedLabelIds.length === 0 ? "nav-active" : ""}`} onClick={() => { setSelectedLabelIds([]); setView("day"); }}>
          <BookOpen size={18} />
          Daily planner
        </div>
        <div className={`nav-item ${view === "pending" ? "nav-active" : ""}`} onClick={() => setView("pending")}>
          <span className="warn-badge" aria-label={`${pendingCount} pending`}>
            {pendingCount}
          </span>
          Pending tasks!
        </div>
        <div
          className={`nav-item ${view === "priority" ? "nav-active" : ""}`}
          onClick={() => setView(view === "priority" ? "day" : "priority")}
        >
          <span className="priority-emoji">🔥</span>
          Priority tasks
        </div>
        <button
          type="button"
          className="sidebar-caption labels-toggle"
          aria-expanded={labelsSectionOpen}
          onClick={() => setLabelsSectionOpen(!labelsSectionOpen)}
        >
          LABELS
          <ChevronDown size={14} className={labelsSectionOpen ? "flip" : ""} />
        </button>
        {(labelsSectionOpen || view === "label" || selectedLabelIds.length > 0) && (
        <div className="labels-section">
          {labels.map((label) => (
            <div
              key={label.id}
              className={`label-item ${selectedLabelIds.includes(label.id) ? "label-active" : ""}`}
              onClick={() => {
                const next = selectedLabelIds.includes(label.id)
                  ? selectedLabelIds.filter((id) => id !== label.id)
                  : [...selectedLabelIds, label.id];
                setSelectedLabelIds(next);
                setView(next.length ? "label" : "day");
                if (next.length) setQuickLabelIds(next);
              }}
            >
              <Tag size={16} />
              {label.name}
              <button
                className="label-delete"
                aria-label={`Delete ${label.name} label`}
                onClick={async (e) => {
                  e.stopPropagation();
                  if (window.confirm(`Delete the "${label.name}" label? Tasks with this label will keep their tasks but lose the label.`)) {
                    setBusy(true);
                    setError("");
                    try {
                      await deleteLabel(label.id);
                      setLabels(labels.filter(l => l.id !== label.id));
                      setTasks((old) =>
                        old.map((t) => ({
                          ...t,
                          label: undefined,
                          labels: taskLabelIds(t).filter((id) => id !== label.id),
                        })),
                      );
                      const next = selectedLabelIds.filter(id => id !== label.id);
                      setSelectedLabelIds(next);
                      if (view === "label" && next.length === 0) {
                        setView("day");
                      }
                      setStatus("Label deleted");
                    } catch (e) {
                      console.error("Delete label error:", e);
                      setError("Failed to delete label. " + (e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }
                }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            className="add-label-button"
            onClick={() => setShowNewLabelModal(true)}
          >
            <PlusIcon size={16} />
            Create label
          </button>
        </div>
        )}
      </aside>
      <main>
        <header>
          <span>Daily planner</span>
          <span className="save-status" role="status">
            {status || "Your daily workspace"}
          </span>
        </header>
        <div className={"content" + (selectedIds.length > 0 ? " content-selecting" : "")}>
          <div className="heading">
            <div>
              <div className="eyebrow">MAKE ROOM FOR WHAT MATTERS</div>
              <h1>Your day, in order.</h1>
              <p>Write it down. Make progress. Close the day.</p>
            </div>
            <div className="date-stamp">
              <strong>{pretty(today, { day: "numeric" })}</strong>
              <span>{pretty(today, { month: "short", weekday: "short" })}</span>
            </div>
          </div>
          <form
            className="quick-add"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                title.trim() &&
                (await save({
                  id: crypto.randomUUID(),
                  title: title.trim(),
                  day,
                  comment: "",
                  done: 0,
                  time: time || undefined,
                  labels: quickLabelIds.length ? quickLabelIds : undefined,
                }))
              ) {
                setTitle("");
                setTime("");
                setQuickLabelIds([]);
                setShowQuickLabels(false);
                setMonth(day.slice(0, 7));
              }
            }}
          >
            <Plus size={21} />
            <input
              aria-label="New task"
              placeholder="What do you need to do?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={500}
            />
            <input
              aria-label="Task date"
              type="date"
              value={day}
              onChange={(e) => selectDay(e.target.value)}
              required
            />
            <input
              aria-label="Task time (optional)"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
            <div className="label-picker">
              <button
                type="button"
                className="label-picker-toggle"
                aria-label="Task labels (optional)"
                onClick={() => setShowQuickLabels(!showQuickLabels)}
              >
                <Tag size={15} />
                {quickLabelIds.length
                  ? quickLabelIds.length === 1
                    ? labels.find((l) => l.id === quickLabelIds[0])?.name || "1 label"
                    : `${quickLabelIds.length} labels`
                  : "Labels"}
              </button>
              {showQuickLabels && (
                <div className="label-picker-menu">
                  {labels.map((label) => (
                    <label key={label.id} className="label-picker-option">
                      <span className="opt-name">{label.name}</span>
                      <input
                        type="checkbox"
                        checked={quickLabelIds.includes(label.id)}
                        onChange={() =>
                          setQuickLabelIds((prev) =>
                            prev.includes(label.id)
                              ? prev.filter((id) => id !== label.id)
                              : [...prev, label.id],
                          )
                        }
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    className="label-picker-new"
                    onClick={() => setShowNewLabelModal(true)}
                  >
                    <PlusIcon size={14} />
                    Create new label
                  </button>
                </div>
              )}
            </div>
            <button className="primary" disabled={busy || loading}>
              Add task
            </button>
          </form>
          <div className="search-bar">
            <Search size={19} />
            <input
              type="search"
              aria-label="Search all tasks and comments"
              placeholder="Search tasks and comments across all dates…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && <button onClick={() => setQuery("")}>Clear</button>}
          </div>
          {searching && (
            <p className="search-summary" role="status">
              {matching.length} result{matching.length === 1 ? "" : "s"} across
              all dates
            </p>
          )}
          {error && (
            <div className="error" role="alert">
              {error} <button onClick={refresh}>Reload tasks</button>
            </div>
          )}
          <div className="monthbar">
            <div className="monthnav">
              <h2>
                {pretty(month + "-01", { month: "long", year: "numeric" })}
              </h2>
              <button
                aria-label="Previous month"
                onClick={() => changeMonth(-1)}
              >
                <ChevronLeft size={18} />
              </button>
              <button aria-label="Next month" onClick={() => changeMonth(1)}>
                <ChevronRight size={18} />
              </button>
              <button
                onClick={() => {
                  selectDay(today);
                  setView("day");
                }}
              >
                Today
              </button>
            </div>
            <span>
              {completed} of {visible.length} tasks done · {completeDays} days
              complete
            </span>
          </div>
          <div className="planner-controls">
            <div className="view-switch" aria-label="Planner view">
              <button
                aria-pressed={view === "day"}
                onClick={() => setView("day")}
              >
                Day view
              </button>
              <button
                aria-pressed={view === "month"}
                onClick={() => setView("month")}
              >
                Month overview
              </button>
              <button
                aria-pressed={showCalendar}
                onClick={() => setShowCalendar(!showCalendar)}
              >
                Calendar view
              </button>
            </div>
            <label className="jump-date">
              Jump to date
              <input
                type="date"
                aria-label="Jump to date"
                value={day}
                onChange={(e) => {
                  selectDay(e.target.value);
                  setView("day");
                }}
              />
            </label>
            {"Notification" in window && notificationPermission !== "granted" && (
              <button
                className="secondary"
                onClick={requestNotificationPermission}
              >
                Enable notifications
              </button>
            )}
          </div>
          <div className="export-toolbar">
            <div>
              {unsaved > 0 && (
                <span role="status">
                  {unsaved} unsaved comment{unsaved === 1 ? "" : "s"} — save
                  below before exporting.
                </span>
              )}
            </div>
            <label>
              Export
              <select
                aria-label="PDF export period"
                value={exportScope}
                onChange={(e) => setExportScope(e.target.value)}
              >
                <option value="day">Selected day</option>
                <option value="month">Selected month</option>
                <option value="all">All dates</option>
              </select>
            </label>
            <button
              className="export-button"
              onClick={exportPdf}
              disabled={busy || loading || exporting || unsaved > 0}
            >
              <Download size={16} />
              {exporting ? "Preparing PDF…" : "Download PDF"}
            </button>
          </div>
          <nav className="date-strip" aria-label="Days of the month">
            {calendarDays.map((d) => {
              const count = visible.filter((t) => t.day === d).length;
              return (
                <button
                  id={"date-" + d}
                  key={d}
                  aria-current={d === day ? "date" : undefined}
                  aria-label={
                    pretty(d, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    }) +
                    ", " +
                    count +
                    " tasks"
                  }
                  className={d === day ? "selected-date" : ""}
                  onClick={() => {
                    selectDay(d);
                    setView("day");
                  }}
                >
                  <span>{pretty(d, { weekday: "short" })}</span>
                  <strong>{Number(d.slice(-2))}</strong>
                  <small>
                    {count ? count + " tasks" : d === today ? "Today" : "—"}
                  </small>
                </button>
              );
            })}
          </nav>
          {view === "day" && !searching && (
            <div className="day-navigation">
              <button aria-label="Previous day" onClick={() => changeDay(-1)}>
                <ChevronLeft size={18} />
                Previous day
              </button>
              <span>
                {pretty(day, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              <button aria-label="Next day" onClick={() => changeDay(1)}>
                Next day
                <ChevronRight size={18} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="empty">Loading your planner…</div>
          ) : (view === "label" && selectedLabelIds.length) || view === "priority" || view === "pending" ? (
            <div>
              <div className="heading">
                <div>
                  <div className="eyebrow">
                    {view === "priority" ? "PRIORITY TASKS" : view === "pending" ? "PENDING" : "LABELS"}
                  </div>
                  <h1>
                    {view === "priority"
                      ? "🔥 Priority"
                      : view === "pending"
                        ? "Pending tasks!"
                        : labels
                            .filter((l) => selectedLabelIds.includes(l.id))
                            .map((l) => l.name)
                            .join(", ") || "Labels"}
                  </h1>
                  <p>
                    {view === "priority"
                      ? "All priority tasks across every date, grouped by day."
                      : view === "pending"
                        ? "Incomplete tasks rolled forward from their original dates."
                        : "All tasks with the selected labels, grouped by date."}
                  </p>
                </div>
              </div>
              {(() => {
                const labelTasks =
                  view === "priority"
                    ? tasks.filter((t) => t.priority)
                    : view === "pending"
                      ? tasks.filter((t) => !t.done && t.pending_from_date)
                      : tasks.filter((t) =>
                          taskLabelIds(t).some((id) => selectedLabelIds.includes(id)),
                        );
                const labelDays = [...new Set(labelTasks.map((t) => t.day))].sort().reverse();

                if (labelTasks.length === 0) {
                  return (
                    <div className="empty">
                      <Tag />
                      <h3>{view === "pending" ? "No pending tasks." : "No tasks yet"}</h3>
                      <p>
                        {view === "priority"
                          ? "Mark a task as priority with the 🔥 button to see it here."
                          : view === "pending"
                            ? "You're all caught up. Nothing rolled over."
                            : "Create a task and assign it this label to see it here."}
                      </p>
                      <button
                        className="primary"
                        onClick={() => {
                          setView("day");
                          document.querySelector<HTMLInputElement>(".quick-add input")?.focus();
                        }}
                      >
                        Add task
                      </button>
                    </div>
                  );
                }

                return labelDays.map((d) => {
                  const dayTasks = sortTasksForDay(labelTasks.filter((t) => t.day === d));
                  const count = dayTasks.filter((t) => t.done).length;
                  const done = dayTasks.length > 0 && dayTasks.every((t) => t.done);

                  return (
                    <section key={d} className={"day-card " + (done ? "day-done" : "")}>
                      <div className="day-heading">
                        <div className="day-number">{pretty(d, { day: "2-digit" })}</div>
                        <div>
                          <h3>
                            {pretty(d, {
                              weekday: "long",
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </h3>
                          <div className="day-meta">
                            {d === today ? "Today · " : ""}
                            {done ? "Everything taken care of" : `${dayTasks.length - count} tasks remaining`}
                          </div>
                        </div>
                        <span className={"day-badge " + (done ? "finished" : "")}>
                          {done ? (
                            <>
                              <Check size={15} />
                              Day complete
                            </>
                          ) : (
                            `${count} / ${dayTasks.length} complete`
                          )}
                        </span>
                      </div>
                      {dayTasks.length > 0 ? (
                        <>
                          <div className="table-head">
                            <span>TASK</span>
                            <span>COMMENT / UPDATE</span>
                          </div>
                          {dayTasks.map(renderTaskRow)}
                        </>
                      ) : (
                        <div className="day-empty">
                          A clear day ahead. Add your first task above.
                        </div>
                      )}
                    </section>
                  );
                });
              })()}
            </div>
          ) : searching && matching.length === 0 ? (
            <div className="empty">
              <h3>No matching tasks.</h3>
              <p>Try another word or search the comments.</p>
            </div>
          ) : view === "month" && days.length === 0 && !searching ? (
            <div className="empty">
              <BookOpen />
              <h3>A fresh page.</h3>
              <p>Add a task for this month to get started.</p>
            </div>
          ) : (
            (searching ? resultDays : view === "day" ? [day] : days).map(
              (d) => {
                const list = sortTasksForDay(matching.filter((t) => t.day === d));
                const count = list.filter((t) => t.done).length;
                const allDayTasks = tasks.filter((t) => t.day === d);
                const done =
                  allDayTasks.length > 0 && allDayTasks.every((t) => t.done);
                return (
                  <section
                    key={d}
                    className={"day-card " + (done ? "day-done" : "")}
                  >
                    <div className="day-heading">
                      <div className="day-number">
                        {pretty(d, { day: "2-digit" })}
                      </div>
                      <div>
                        <h3>
                          {pretty(d, {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                            ...(searching ? { year: "numeric" as const } : {}),
                          })}
                        </h3>
                        {searching && (
                          <button
                            className="open-result-day"
                            onClick={() => {
                              selectDay(d);
                              setView("day");
                              setQuery("");
                            }}
                          >
                            Open this day
                          </button>
                        )}
                        <div className="day-meta">
                          {d === today ? "Today · " : ""}
                          {searching
                            ? `${list.length} matching tasks`
                            : done
                              ? "Everything taken care of"
                              : `${list.length - count} tasks remaining`}
                        </div>
                      </div>
                      <span className={"day-badge " + (done ? "finished" : "")}>
                        {done ? (
                          <>
                            <Check size={15} />
                            Day complete
                          </>
                        ) : (
                          `${count} / ${list.length} complete`
                        )}
                      </span>
                    </div>
                    {list.length > 0 ? (
                      <>
                        <div className="table-head">
                          <span>TASK</span>
                          <span>COMMENT / UPDATE</span>
                        </div>
                        {list.map(renderTaskRow)}
                      </>
                    ) : (
                      <div className="day-empty">
                        A clear day ahead. Add your first task above.
                      </div>
                    )}
                    <button
                      className="add-day"
                      onClick={() => {
                        selectDay(d);
                        document
                          .querySelector<HTMLInputElement>(".quick-add input")
                          ?.focus();
                      }}
                    >
                      <Plus size={16} />
                      Add a task
                    </button>
                  </section>
                );
              },
            )
          )}
          {selectedIds.length > 0 && (
            <div className="batch-bar" role="toolbar" aria-label="Batch actions">
              <span className="batch-count">
                {selectedIds.length} selected
              </span>
              <button
                disabled={busy || selectableTasks.length === 0}
                onClick={() =>
                  setSelectedIds(
                    selectedIds.length === selectableTasks.length
                      ? []
                      : selectableTasks.map((t) => t.id),
                  )
                }
              >
                {selectedIds.length === selectableTasks.length && selectableTasks.length
                  ? "Deselect all"
                  : "Select all"}
              </button>
              <button
                disabled={busy || selectedIds.length === 0}
                onClick={() => batchPush(-1)}
              >
                <ChevronLeft size={15} />
                Push yesterday
              </button>
              <button
                disabled={busy || selectedIds.length === 0}
                onClick={() => batchPush(1)}
              >
                Push tomorrow
                <ChevronRight size={15} />
              </button>
              <button
                className="danger"
                disabled={busy || selectedIds.length === 0}
                onClick={batchDelete}
              >
                <Trash2 size={15} />
                Delete
              </button>
              <button onClick={clearSelection}>Clear</button>
            </div>
          )}
          <footer>
            Check off every task to complete the day. Uncheck any task to reopen
            it.
          </footer>
        </div>
      </main>
      {showCalendar && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCalendar(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-title"
            className="modal calendar-modal"
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowCalendar(false);
            }}
          >
            <div className="modal-heading">
              <h2 id="calendar-title">Calendar View</h2>
              <div className="calendar-year-nav">
                <button
                  onClick={() => setCalendarYear(calendarYear - 1)}
                  disabled={busy}
                >
                  <ChevronLeft size={18} />
                </button>
                <span>{calendarYear}</span>
                <button
                  onClick={() => setCalendarYear(calendarYear + 1)}
                  disabled={busy}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
              <button
                aria-label="Close calendar"
                onClick={() => setShowCalendar(false)}
              >
                <X />
              </button>
            </div>
            <div className="calendar-grid">
              {Array.from({ length: 12 }, (_, monthIndex) => {
                const monthDate = new Date(calendarYear, monthIndex, 1);
                const monthKey = `${calendarYear}-${String(monthIndex + 1).padStart(2, "0")}`;
                const daysInMonth = new Date(calendarYear, monthIndex + 1, 0).getDate();
                const monthTasks = tasks.filter((t) => t.day.startsWith(monthKey));
                const completedTasks = monthTasks.filter((t) => t.done).length;

                return (
                  <div key={monthKey} className="calendar-month">
                    <h3>
                      {monthDate.toLocaleDateString("en-US", { month: "long" })}
                    </h3>
                    <div className="calendar-month-summary">
                      {completedTasks}/{monthTasks.length} tasks done
                    </div>
                    <div className="calendar-days">
                      {Array.from({ length: daysInMonth }, (_, dayIndex) => {
                        const dayKey = `${monthKey}-${String(dayIndex + 1).padStart(2, "0")}`;
                        const dayTasks = tasks.filter((t) => t.day === dayKey);
                        const dayCompleted = dayTasks.length > 0 && dayTasks.every((t) => t.done);
                        const isToday = dayKey === today;

                        return (
                          <button
                            key={dayKey}
                            className={`calendar-day ${dayCompleted ? "day-complete" : ""} ${isToday ? "today" : ""} ${dayTasks.length > 0 ? "has-tasks" : ""}`}
                            onClick={() => {
                              selectDay(dayKey);
                              setView("day");
                              setShowCalendar(false);
                            }}
                            title={`${dayTasks.length} task${dayTasks.length === 1 ? "" : "s"}`}
                          >
                            <span className="day-number">{dayIndex + 1}</span>
                            {dayTasks.length > 0 && (
                              <div className="day-tasks-list">
                                {dayTasks.slice(0, 3).map((task) => (
                                  <div key={task.id} className="day-task-item">
                                    <span className={`task-bullet ${task.done ? "task-done" : ""}`} />
                                    <span className="task-text-preview">{task.title.substring(0, 20)}{task.title.length > 20 ? "..." : ""}</span>
                                  </div>
                                ))}
                                {dayTasks.length > 3 && (
                                  <span className="more-tasks">+{dayTasks.length - 3} more</span>
                                )}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {tasks.length === 0 && (
                <div className="empty" style={{ gridColumn: "1 / -1" }}>
                  <BookOpen />
                  <h3>No tasks yet</h3>
                  <p>Add tasks to see them in the calendar</p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      {showNewLabelModal && (
        <div
          className="modal-backdrop modal-backdrop-top"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setShowNewLabelModal(false);
              setNewLabelName("");
              setLabelError("");
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-label-title"
            className="modal"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) {
                setShowNewLabelModal(false);
                setNewLabelName("");
                setLabelError("");
              }
            }}
          >
            <div className="modal-heading">
              <h2 id="new-label-title">Create label</h2>
              <button
                aria-label="Close"
                disabled={busy}
                onClick={() => {
                  setShowNewLabelModal(false);
                  setNewLabelName("");
                  setLabelError("");
                }}
              >
                <X />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await handleCreateLabel();
              }}
            >
              <label>
                Label name
                <input
                  autoFocus
                  required
                  maxLength={50}
                  placeholder="e.g., Follow-ups, Work, Personal"
                  value={newLabelName}
                  onChange={(e) => setNewLabelName(e.target.value)}
                />
              </label>
              {labelError && (
                <p role="alert" className="error">
                  {labelError}
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setShowNewLabelModal(false);
                    setNewLabelName("");
                    setLabelError("");
                  }}
                >
                  Cancel
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? "Creating…" : "Create label"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {editing && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) void closeEditor();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-title"
            className="modal task-modal"
            onKeyDown={(e) => {
              if (e.key === "Escape") void closeEditor();
              if (e.key === "Tab") {
                const els = e.currentTarget.querySelectorAll<HTMLElement>(
                  "button:not(:disabled),input,textarea",
                );
                const first = els[0],
                  last = els[els.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <div className="task-modal-head">
              <h2 id="edit-title">Task details</h2>
              <span
                className={"autosave-status is-" + saveState}
                role="status"
                aria-live="polite"
              >
                {saveState === "saving" ? (
                  "Saving…"
                ) : saveState === "saved" ? (
                  "Saved"
                ) : saveState === "error" ? (
                  <>
                    Couldn’t save —{" "}
                    <button type="button" onClick={() => queueAutosave()}>
                      Retry
                    </button>
                  </>
                ) : (
                  "Autosave on"
                )}
              </span>
              <button
                aria-label="Close task details"
                className="icon-btn"
                onClick={() => void closeEditor()}
              >
                <X size={18} />
              </button>
            </div>
            <div className="task-modal-body">
              <label className="field">
                Task
                <input
                  autoFocus
                  required
                  maxLength={500}
                  value={editing.title}
                  aria-invalid={!editing.title.trim()}
                  onChange={(e) => onEditText("title", e.target.value)}
                  onBlur={flushTextAutosave}
                  onCompositionStart={() => (composing.current = true)}
                  onCompositionEnd={() => {
                    composing.current = false;
                    scheduleTextAutosave();
                  }}
                />
                {!editing.title.trim() && (
                  <span className="field-error" role="alert">
                    Title can’t be empty.
                  </span>
                )}
              </label>
              <div className="field-row">
                <label className="field">
                  Date
                  <input
                    type="date"
                    required
                    value={editing.day}
                    onChange={(e) => {
                      if (e.target.value) applyEdit({ day: e.target.value });
                    }}
                  />
                </label>
                <label className="field">
                  Time (optional)
                  <input
                    type="time"
                    value={editing.time || ""}
                    onChange={(e) =>
                      applyEdit({ time: e.target.value || undefined })
                    }
                  />
                </label>
              </div>
              {editing.time && (
                <div className="field-hint">
                  Displayed as {formatTime(editing.time)} — reminder 10 min
                  before.
                </div>
              )}
              <div className="field">
                <span className="field-label" id="edit-labels-label">
                  Labels (optional)
                </span>
                <div className="label-select">
                  <button
                    type="button"
                    className="label-select-toggle"
                    aria-labelledby="edit-labels-label"
                    aria-expanded={editLabelsOpen}
                    onClick={() => {
                      setLabelQuery("");
                      setEditLabelsOpen(!editLabelsOpen);
                    }}
                  >
                    <Tag size={14} />
                    <span className="label-select-value">
                      {taskLabels(editing).length
                        ? taskLabels(editing)
                            .map((l) => l.name)
                            .join(", ")
                        : "No labels"}
                    </span>
                    <ChevronDown
                      size={14}
                      className={editLabelsOpen ? "flip" : ""}
                    />
                  </button>
                  {editLabelsOpen &&
                    renderLabelMenu(
                      taskLabelIds(editing),
                      (id) => {
                        const cur = taskLabelIds(editingRef.current ?? editing);
                        const next = cur.includes(id)
                          ? cur.filter((x) => x !== id)
                          : [...cur, id];
                        applyEdit({
                          labels: next.length ? next : undefined,
                          label: undefined,
                        });
                      },
                      () => applyEdit({ labels: undefined, label: undefined }),
                      () => {
                        setEditLabelsOpen(false);
                        setShowNewLabelModal(true);
                      },
                      () => setEditLabelsOpen(false),
                    )}
                </div>
              </div>
              <label className="field">
                Comment / update
                <textarea
                  rows={5}
                  maxLength={10000}
                  placeholder="What happened? What’s next?"
                  value={editing.comment}
                  onChange={(e) => onEditText("comment", e.target.value)}
                  onBlur={flushTextAutosave}
                  onCompositionStart={() => (composing.current = true)}
                  onCompositionEnd={() => {
                    composing.current = false;
                    scheduleTextAutosave();
                  }}
                />
              </label>
              {saveState === "error" && (
                <p role="alert" className="error">
                  {saveMsg}
                </p>
              )}
            </div>
            <div className="task-modal-foot">
              {deleting === editing.id ? (
                <span className="delete-confirm">
                  Delete task?
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={async () => {
                      // Cancel pending autosaves so a queued write can’t
                      // resurrect a deleted task.
                      queuedTask.current = null;
                      editDirty.current.clear();
                      while (saveDrain.current) await saveDrain.current;
                      queuedTask.current = null;
                      await removeTask(editing);
                      setEditing(null);
                    }}
                  >
                    Delete
                  </button>
                  <button disabled={busy} onClick={() => setDeleting(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="delete-task modal-delete"
                  aria-label={"Delete " + editing.title}
                  disabled={busy}
                  onClick={() => setDeleting(editing.id)}
                >
                  <Trash2 size={15} />
                  <span>Delete</span>
                </button>
              )}
              <div className="foot-push">
                <button
                  type="button"
                  className="secondary-sm"
                  aria-label="Push task to yesterday"
                  title="Push to yesterday"
                  onClick={() => {
                    const cur = editingRef.current;
                    if (!cur) return;
                    const d = new Date(cur.day + "T12:00:00");
                    d.setDate(d.getDate() - 1);
                    applyEdit({ day: dateKey(d) });
                  }}
                >
                  <ChevronLeft size={15} />
                  Yesterday
                </button>
                <button
                  type="button"
                  className="secondary-sm"
                  aria-label="Push task to tomorrow"
                  title="Push to tomorrow"
                  onClick={() => {
                    const cur = editingRef.current;
                    if (!cur) return;
                    const d = new Date(cur.day + "T12:00:00");
                    d.setDate(d.getDate() + 1);
                    applyEdit({ day: dateKey(d) });
                  }}
                >
                  Tomorrow
                  <ChevronRight size={15} />
                </button>
              </div>
              <button
                type="button"
                className="primary"
                onClick={() => void closeEditor()}
              >
                Done
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
