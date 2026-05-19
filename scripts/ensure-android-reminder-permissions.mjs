import { readFileSync, writeFileSync, existsSync } from "node:fs";

const manifestPath = new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url);

if (!existsSync(manifestPath)) {
  process.exit(0);
}

const permissionLines = [
  '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />'
];

const current = readFileSync(manifestPath, "utf8");
const missingPermissions = permissionLines.filter((line) => {
  const match = line.match(/android\.permission\.[A-Z_]+/);
  return match && !current.includes(match[0]);
});

if (!missingPermissions.length) {
  process.exit(0);
}

const applicationIndex = current.indexOf("<application");
if (applicationIndex === -1) {
  process.exit(0);
}

const updated =
  current.slice(0, applicationIndex) +
  `${missingPermissions.join("\n")}\n` +
  current.slice(applicationIndex);

writeFileSync(manifestPath, updated);
process.stdout.write("Android reminder permissions added to manifest.\n");
