import { readFileSync, writeFileSync, existsSync } from "node:fs";

const manifestPath = new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url);

if (!existsSync(manifestPath)) {
  process.exit(0);
}

const permissionLine =
  '    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />';

const current = readFileSync(manifestPath, "utf8");
if (current.includes("android.permission.SCHEDULE_EXACT_ALARM")) {
  process.exit(0);
}

const applicationIndex = current.indexOf("<application");
if (applicationIndex === -1) {
  process.exit(0);
}

const updated =
  current.slice(0, applicationIndex) +
  `${permissionLine}\n` +
  current.slice(applicationIndex);

writeFileSync(manifestPath, updated);
process.stdout.write("Android exact alarm permission added to manifest.\n");
