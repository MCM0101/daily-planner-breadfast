# Daybook for Firebase

An independently deployable version of your Daybook planner. Open this folder in VS Code. The complete frontend, favicon, PDF generator, authentication, Firestore integration, rules, build configuration, and lockfile are included. This copy uses React + Vite, Firebase Authentication, Firestore, and Firebase Hosting. It does not call the original Site or require ChatGPT, Cloudflare, or an OpenAI key.

## Features

- Daily and monthly task views, date navigation, and future scheduling.
- Task completion, automatic shading/strikethrough of completed days, editing and deletion.
- Inline comments with explicit Save and conflict detection.
- Search across all task titles and comments.
- PDF download for a day, month, or all dates.
- Email/password sign-in and private per-user tasks.
- JSON backup download and idempotent restore for migration.

## 1. Create your Firebase project

1. In https://console.firebase.google.com create a project and register a **Web app**.
2. In **Build → Authentication → Sign-in method**, enable **Email/Password**.
3. In **Authentication → Users**, choose **Add user** and create your own account. There is no public registration button in this app.
4. In **Build → Firestore Database**, create the default database using **Standard edition / Native mode**, in a region you choose. Start in production mode. Deploy the included rules in step 3 below before using the planner.
5. In the Web app settings, copy `apiKey`, `authDomain`, `projectId`, and `appId` into your local environment file as shown below. These are browser app identifiers, not an Admin service-account key.

Each signed-in user can access only their own `users/{uid}/tasks` documents. The rules enforce this even if someone bypasses the UI. Keep the included rules; do not switch to public read/write rules. This is a per-user planner, not a shared team database.

## 2. Run locally

Install Node.js **22.13+** (Node 22 or 24 recommended), then run in the VS Code terminal:

```bash
npm ci
cp .env.example .env.local
```

On Windows PowerShell use `Copy-Item .env.example .env.local` instead of `cp`.

Edit `.env.local` with your Firebase Web app configuration:

```dotenv
VITE_FIREBASE_API_KEY=your-web-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_APP_ID=your-web-app-id
```

```bash
npm run dev
```

Open the localhost URL printed in the terminal and sign in using the account you created. The local app connects to your Firebase database, so edits are real. If configuration is missing, the app shows setup instructions rather than attempting to connect.

## 3. Deploy independently to Firebase Hosting

Install the Firebase CLI and sign in:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
```

Select your Firebase project and name the alias `default`. This creates `.firebaserc`. No project ID or account credential is preconfigured in this package.

Publish the database rules before using the app locally:

```bash
firebase deploy --only firestore:rules
```

Build and publish the web app and rules:

```bash
npm run deploy
```

This runs `npm run build` and `firebase deploy --only hosting,firestore:rules`. `firebase.json` serves `dist/` and rewrites routes to the app. You do not need Firebase App Hosting or Cloud Functions for this version. The output URL is printed by Firebase.

Environment values are compiled into the browser build. If you change `.env.local`, rebuild and redeploy. Never put private service-account credentials in a `VITE_` variable.

## 4. Restore your current tasks

The separately supplied `daybook-task-backup.json` contains a snapshot of your live planner, including imported spreadsheet tasks and subsequent edits.

1. Deploy the Firestore rules and sign in to this app as your own account.
2. Open **Data backup** in the top bar.
3. Choose **Restore task backup** and select the JSON file.
4. Wait for the imported/preserved count. Existing task IDs are never overwritten; a partial import can be safely retried.

Restore preserves dates, task text, comments, and checked status. Blank days remain blank. Version counters start at 1 in the new database. The original hosted Site and its database are not changed. There is no ongoing synchronization between the two apps after migration.

Keep task backups outside your GitHub repository. The source ZIP intentionally does not contain your private task data. `backups/` is ignored if you choose to store local copies there.

## 5. Upload to GitHub

Create an empty GitHub repository, then run:

```bash
git init
git add .
git commit -m "Add Daybook Firebase app"
git branch -M main
git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPO.git
git push -u origin main
```

Replace the remote URL. `.env.local`, dependencies, builds, and backups are ignored. Commit `package-lock.json` so others install the same dependency versions. You can deploy manually from any machine with this repo and Firebase permissions. For optional GitHub deployment integration, follow Firebase's official Hosting GitHub setup after the first manual deployment.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local development with live updates |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Preview the production frontend locally |
| `npm test` | Task/backup validation checks |
| `npm run deploy` | Build and deploy Hosting and Firestore rules |

## Source map

- `src/app/Planner.tsx`: planner interface, search, comments, date navigation.
- `src/app/globals.css`: responsive styles.
- `src/main.tsx`: sign-in, account controls, backup/restore.
- `src/lib/task-store.ts`: Firestore reads, versioned transactions, and deletion.
- `src/lib/task-validation.ts`: task and backup validation.
- `src/lib/firebase.ts`: Firebase initialization.
- `src/lib/export-pdf.ts`: printable PDF layout and download.
- `public/favicon.svg`: app icon; no external image or font dependencies.
- `firestore.rules`: authentication, ownership, and field validation.
- `firebase.json`, `vite.config.ts`, `tsconfig.json`: deployment and build configuration.

## Validation and limits

The supplied project was dependency-installed, type-checked, and production-built locally, with validation tests. Deployment to your Firebase account and end-to-end Firebase login/Firestore authorization still need verification after you configure the project. No Firebase project or cloud resources were created on your behalf.

Firestore writes require a connection. A failed save preserves the input and displays an error; it does not claim offline synchronization. Inline comments must be saved before export or sign-out. Search loads this personal planner's tasks into the browser; very large datasets would need pagination/search indexing. The PDF generator uses Helvetica, suitable for the existing English task data; additional scripts such as Arabic require embedding an appropriate font and text shaping before relying on PDF output for those languages.

## Official references

- Hosting: https://firebase.google.com/docs/hosting/quickstart
- Password authentication: https://firebase.google.com/docs/auth/web/password-auth
- Firestore rules: https://firebase.google.com/docs/firestore/security/rules-conditions
- Transactions: https://firebase.google.com/docs/firestore/manage-data/transactions
- GitHub deployment integration: https://firebase.google.com/docs/hosting/github-integration
