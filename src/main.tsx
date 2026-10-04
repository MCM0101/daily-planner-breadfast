import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updatePassword,
  signOut,
  type User,
} from "firebase/auth";
import { auth, configured } from "./lib/firebase";
import { restoreBackup, taskRequest } from "./lib/task-store";
import type { Task } from "./lib/task-validation";
import Planner from "./app/Planner";
import "./app/globals.css";
function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [revision, setRevision] = useState(0),
    [isSignUp, setIsSignUp] = useState(false),
    [showChangePassword, setShowChangePassword] = useState(false),
    [newPassword, setNewPassword] = useState("");
  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      setMessage("");
    });
  }, []);
  if (!configured)
    return (
      <main className="login">
        <h1>Set up Daybook</h1>
        <p>
          Copy .env.example to .env.local, add your Firebase web app
          configuration, then restart the development server. See README.md for
          the full setup.
        </p>
      </main>
    );
  if (loading) return <main className="login">Loading…</main>;
  if (!user)
    return (
      <main className="login">
        <h1>daybook.</h1>
        <p>{isSignUp ? "Create your account" : "Sign in to your private planner."}</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            try {
              if (isSignUp) {
                await createUserWithEmailAndPassword(auth!, email, password);
                setMessage("Account created successfully!");
              } else {
                await signInWithEmailAndPassword(auth!, email, password);
              }
              setPassword("");
            } catch (error: any) {
              setMessage(
                isSignUp
                  ? "Could not create account. " + (error.message || "Email may already be in use.")
                  : "Could not sign in. Check your email and password, or try again later.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? (isSignUp ? "Creating account…" : "Signing in…") : (isSignUp ? "Sign up" : "Sign in")}
          </button>
        </form>
        <button
          className="secondary"
          onClick={() => {
            setIsSignUp(!isSignUp);
            setMessage("");
          }}
        >
          {isSignUp ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
        </button>
        {message && <p role="alert">{message}</p>}
      </main>
    );
  return (
    <>
      <div className="account-tools">
        <span>{user.email}</span>
        <details>
          <summary>Data backup</summary>
          <div className="backup-options">
            <p>
              Import preserves existing tasks. Save any comment edits before
              importing.
            </p>
            <label>
              Restore task backup
              <input
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setBusy(true);
                  try {
                    const backup = JSON.parse(await file.text());
                    const result = await restoreBackup(
                      backup,
                      (n, total) => setMessage(`Importing ${n} of ${total}…`),
                    );
                    setMessage(
                      `Imported ${result.imported}; preserved ${result.skipped} existing tasks.`,
                    );
                    setRevision((x) => x + 1);
                  } catch (e) {
                    setMessage(
                      (e as Error).message + " You can retry the same file.",
                    );
                  } finally {
                    setBusy(false);
                    e.target.value = "";
                  }
                }}
              />
            </label>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await taskRequest("/api/tasks");
                  if (!r.ok) throw Error("Unable to export backup.");
                  const { tasks } = await r.json();
                  const url = URL.createObjectURL(
                    new Blob(
                      [
                        JSON.stringify(
                          {
                            format: "daybook-v3",
                            exportedAt: new Date().toISOString(),
                            tasks: tasks.map((t: Task) => {
                              const task: any = {
                                id: t.id,
                                title: t.title,
                                day: t.day,
                                comment: t.comment,
                                done: t.done,
                                version: t.version,
                              };
                              if (t.time !== undefined) task.time = t.time;
                              if (t.source_id !== undefined) task.source_id = t.source_id;
                              if (t.label !== undefined) task.label = t.label;
                              return task;
                            }),
                          },
                          null,
                          2,
                        ),
                      ],
                      { type: "application/json" },
                    ),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "daybook-backup.json";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Download JSON backup
            </button>
          </div>
        </details>
        <button
          disabled={busy}
          onClick={() => setShowChangePassword(!showChangePassword)}
        >
          Change password
        </button>
        {showChangePassword && (
          <form
            className="change-password-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMessage("");
              try {
                await updatePassword(user, newPassword);
                setMessage("Password updated successfully!");
                setNewPassword("");
                setShowChangePassword(false);
              } catch (error: any) {
                setMessage(
                  "Could not update password. " + (error.message || "You may need to re-sign in first."),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? "Updating…" : "Update password"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowChangePassword(false);
                setNewPassword("");
              }}
            >
              Cancel
            </button>
          </form>
        )}
        <button
          disabled={busy}
          onClick={async () => {
            if (window.confirm("Sign out? Save any comment edits first."))
              await signOut(auth!);
          }}
        >
          Sign out
        </button>
      </div>
      {message && (
        <div className="backup-status" role="status">
          {message}
        </div>
      )}
      <Planner key={user.uid + "-" + revision} />
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
