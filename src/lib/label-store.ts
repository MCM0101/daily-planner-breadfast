import {
  collection,
  doc,
  getDocsFromServer,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  arrayRemove,
  runTransaction,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import type { Label } from "./task-validation";

function labelCollection() {
  if (!db || !auth?.currentUser) throw Error("Sign in first.");
  return collection(db, "users", auth.currentUser.uid, "labels");
}

export async function getLabels() {
  if (!db || !auth?.currentUser) throw Error("Sign in first.");
  const ref = labelCollection();
  const rows = await getDocsFromServer(ref);
  return rows.docs.map((x) => x.data() as Label);
}

export async function createLabel(name: string): Promise<Label> {
  if (!db || !auth?.currentUser) throw Error("Sign in first.");
  const trimmedName = name.trim();
  if (!trimmedName) throw Error("Label name cannot be blank");

  // Check for duplicates (case-insensitive)
  const existing = await getDocsFromServer(
    query(labelCollection(), where("name", "==", trimmedName)),
  );
  if (!existing.empty) {
    throw Error("A label with this name already exists");
  }

  const id = crypto.randomUUID();
  const label: Label = {
    id,
    name: trimmedName,
    createdAt: new Date().toISOString(),
    hasBeenUsed: false,
  };

  await setDoc(doc(labelCollection(), id), label);
  return label;
}

export async function deleteLabel(labelId: string): Promise<void> {
  if (!db || !auth?.currentUser) throw Error("Sign in first.");

  // Remove the label from all tasks that use it (array or legacy field)
  const tasksRef = collection(db, "users", auth.currentUser.uid, "tasks");
  const tasksWithLabel = await getDocsFromServer(
    query(tasksRef, where("labels", "array-contains", labelId)),
  );
  const legacyTasks = await getDocsFromServer(
    query(tasksRef, where("label", "==", labelId)),
  );

  const updated = new Set<string>();
  for (const taskDoc of tasksWithLabel.docs) {
    const task = taskDoc.data();
    await updateDoc(taskDoc.ref, {
      labels: arrayRemove(labelId),
      version: (task.version || 0) + 1,
    });
    updated.add(taskDoc.id);
  }
  for (const taskDoc of legacyTasks.docs) {
    if (updated.has(taskDoc.id)) continue;
    const task = taskDoc.data();
    await updateDoc(taskDoc.ref, {
      label: deleteField(),
      version: (task.version || 0) + 1,
    });
  }

  // Then delete the label
  await deleteDoc(doc(labelCollection(), labelId));
}

export async function markLabelAsUsed(labelId: string): Promise<void> {
  if (!db || !auth?.currentUser) throw Error("Sign in first.");
  const ref = doc(labelCollection(), labelId);
  const current = await getDoc(ref);
  if (!current.exists()) return;

  const label = current.data() as Label;
  if (!label.hasBeenUsed) {
    await updateDoc(ref, { hasBeenUsed: true });
  }
}
