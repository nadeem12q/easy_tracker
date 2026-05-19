export function slugifyHabitName(value) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || `habit-${Date.now().toString(36)}`;
}

export function formatDateInput(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

export function formatTimeLabel(timeText) {
  if (!timeText) return "No reminder";

  const [hourText, minuteText] = String(timeText).split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return timeText;
  }

  const suffix = hour >= 12 ? "PM" : "AM";
  const normalizedHour = hour % 12 || 12;
  return `${normalizedHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function hashToInt(value) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return (Math.abs(hash) % 2147483647) || 1;
}

export function normalizeRepeatDays(days) {
  const fallback = [0, 1, 2, 3, 4, 5, 6];
  if (!Array.isArray(days) || !days.length) return fallback;

  const normalized = [
    ...new Set(days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))
  ].sort((a, b) => a - b);

  return normalized.length ? normalized : fallback;
}

export function getNextDateForRepeatDays(timeText, repeatDays, offsetMinutes = 0) {
  const [hourText, minuteText] = String(timeText || "").split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }

  if (offsetMinutes > 0) {
    return new Date(Date.now() + offsetMinutes * 60 * 1000);
  }

  const allowedDays = normalizeRepeatDays(repeatDays);
  const now = new Date();

  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = new Date();
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);

    if (candidate.getTime() > now.getTime() && allowedDays.includes(candidate.getDay())) {
      return candidate;
    }
  }

  return null;
}
