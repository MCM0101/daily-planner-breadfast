import { readFileSync, writeFileSync } from "fs";

type ImportEntry = {
  source_id: string;
  date: string;
  task_body: string;
  comment: string;
  completed: boolean;
  completion_status: string;
  source: {
    file: string;
    sheet: string;
    row: number;
  };
};

type ImportData = {
  schema_version: number;
  entries: ImportEntry[];
};

function convertImportToBackupFormat(jsonPath: string, outputPath: string) {
  console.log("📖 Reading import file...");
  const jsonContent = readFileSync(jsonPath, "utf-8");
  const data: ImportData = JSON.parse(jsonContent);

  console.log(`📊 Found ${data.entries.length} entries`);

  // Validate
  console.log("🔍 Validating data...");
  const errors: string[] = [];
  const seenSourceIds = new Set<string>();

  for (const entry of data.entries) {
    if (!entry.source_id) errors.push(`Missing source_id in entry`);
    if (seenSourceIds.has(entry.source_id)) errors.push(`Duplicate source_id: ${entry.source_id}`);
    seenSourceIds.add(entry.source_id);

    if (!entry.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
      errors.push(`Invalid date: ${entry.date} for ${entry.source_id}`);
    }
    if (!entry.task_body || !entry.task_body.trim()) {
      errors.push(`Empty task_body for ${entry.source_id}`);
    }
    if (typeof entry.completed !== "boolean") {
      errors.push(`Invalid completed value for ${entry.source_id}`);
    }
  }

  if (errors.length > 0) {
    console.error("❌ Validation errors:");
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log("✅ Validation passed");

  // Convert to backup format
  console.log("🔄 Converting to backup format...");
  const backupData = {
    format: "daybook-v2",
    exportedAt: new Date().toISOString(),
    tasks: data.entries.map((entry) => ({
      id: `import-${entry.source_id}`,
      title: entry.task_body.trim(),
      day: entry.date,
      comment: entry.comment || "",
      done: entry.completed ? 1 : 0,
      version: 1,
      source_id: entry.source_id,
    })),
  };

  writeFileSync(outputPath, JSON.stringify(backupData, null, 2));
  console.log(`✅ Converted to ${outputPath}`);
  console.log(`📊 ${backupData.tasks.length} tasks ready for import`);

  // Also create a labels export if any tasks have labels
  const usedLabelIds = new Set<string>();
  backupData.tasks.forEach((task) => {
    if (task.label) usedLabelIds.add(task.label);
  });

  if (usedLabelIds.size > 0) {
    console.log(`🏷️  Found ${usedLabelIds.size} labels referenced in tasks`);
    console.log("   Note: Label definitions will need to be created separately in the app");
  }
}

const args = process.argv.slice(2);
const jsonPath = args[0];
const outputPath = args[1] || "daybook-backup-import.json";

if (!jsonPath) {
  console.error("Usage: node scripts/convert-import.ts <input-json> [output-json]");
  process.exit(1);
}

convertImportToBackupFormat(jsonPath, outputPath).catch((error: unknown) => {
  console.error("❌ Conversion failed:", error);
  process.exit(1);
});
