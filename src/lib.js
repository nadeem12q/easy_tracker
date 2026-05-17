export function slugifyHabitName(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function formatDateInput(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function weekdayFromDate(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  return date.getDay();
}

export function calculateSleepDuration(sleepTime, wakeTime) {
  if (!sleepTime || !wakeTime) {
    return { minutes: null, label: "" };
  }

  const [sleepHour, sleepMinute] = sleepTime.split(":").map(Number);
  const [wakeHour, wakeMinute] = wakeTime.split(":").map(Number);

  if ([sleepHour, sleepMinute, wakeHour, wakeMinute].some((value) => Number.isNaN(value))) {
    return { minutes: null, label: "" };
  }

  const sleepMinutes = sleepHour * 60 + sleepMinute;
  const wakeMinutes = wakeHour * 60 + wakeMinute;

  let total = wakeMinutes - sleepMinutes;
  if (total < 0) {
    total += 24 * 60;
  }

  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const label = `${hours}h ${minutes}m`;

  return { minutes: total, label };
}

export function createLocalId(prefix = "item") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
