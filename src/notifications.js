import { Capacitor } from "@capacitor/core";
import { formatDateInput, formatTimeLabel, hashToInt } from "./lib.js";
import { logReminderAction } from "./reminderApi.js";

const ACTION_TYPE_ID = "habit-reminder-actions";
const ACTION_YES = "habit_yes";
const ACTION_NO = "habit_no";
const ACTION_LATER = "habit_later";
const REMINDER_CHANNEL_ID = "habit-reminders";
const webReminderTimers = new Map();

let pluginPromise = null;
let actionListenerBound = false;

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function getLocalNotifications() {
  if (!pluginPromise) {
    pluginPromise = import("@capacitor/local-notifications")
      .then((module) => module.LocalNotifications)
      .catch(() => null);
  }

  return pluginPromise;
}

function normalizeRepeatDays(days) {
  if (!Array.isArray(days) || !days.length) return [0, 1, 2, 3, 4, 5, 6];
  const normalized = [...new Set(days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
  return normalized.length ? normalized : [0, 1, 2, 3, 4, 5, 6];
}

function shouldRunOnDate(habit, date = new Date()) {
  return normalizeRepeatDays(habit.reminder_repeat_days).includes(date.getDay());
}

function buildReminderBody(habit) {
  if (habit.reminder_message?.trim()) {
    return habit.reminder_message.trim();
  }

  return `Kya aap ne ${habit.name} complete kar li hai?`;
}

function getReminderId(habitId, dayIndex = 0) {
  return hashToInt(`habit-reminder:${habitId}:${dayIndex}`);
}

function getLaterReminderId(habitId, dateText) {
  return hashToInt(`habit-reminder-later:${habitId}:${dateText}`);
}

function clearWebReminder(habitId) {
  const timer = webReminderTimers.get(habitId);
  if (timer) {
    window.clearTimeout(timer);
    webReminderTimers.delete(habitId);
  }
}

function getNextReminderDate(timeText, repeatDays = [0, 1, 2, 3, 4, 5, 6], offsetMinutes = 0) {
  if (offsetMinutes > 0) {
    return new Date(Date.now() + offsetMinutes * 60 * 1000);
  }

  const [hourText, minuteText] = String(timeText || "").split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }

  const selectedDays = normalizeRepeatDays(repeatDays);
  const now = new Date();

  for (let offset = 0; offset <= 7; offset += 1) {
    const next = new Date();
    next.setDate(now.getDate() + offset);
    next.setHours(hour, minute, 0, 0);

    if (next.getTime() <= now.getTime()) continue;
    if (selectedDays.includes(next.getDay())) return next;
  }

  return null;
}

async function ensureNativeNotificationsReady() {
  const LocalNotifications = await getLocalNotifications();
  if (!LocalNotifications) {
    return { available: false, permission: "denied" };
  }

  const permission = await LocalNotifications.checkPermissions();
  let display = permission.display;

  if (display !== "granted") {
    const requested = await LocalNotifications.requestPermissions();
    display = requested.display;
  }

  if (display !== "granted") {
    return { available: false, permission: display };
  }

  await LocalNotifications.createChannel({
    id: REMINDER_CHANNEL_ID,
    name: "Habit Reminders",
    description: "Daily reminder notifications for MeTrack habits",
    importance: 4,
    visibility: 1,
    vibration: true
  }).catch(() => {});

  await LocalNotifications.registerActionTypes({
    types: [
      {
        id: ACTION_TYPE_ID,
        actions: [
          { id: ACTION_YES, title: "Yes" },
          { id: ACTION_NO, title: "No" },
          { id: ACTION_LATER, title: "Later" }
        ]
      }
    ]
  }).catch(() => {});

  return { available: true, permission: display };
}

function scheduleWebReminder(habit, onNotify) {
  clearWebReminder(habit.id);

  if (!habit.reminder_enabled || !habit.reminder_time) {
    return;
  }

  const next = getNextReminderDate(habit.reminder_time, habit.reminder_repeat_days);
  if (!next) {
    return;
  }

  const delay = Math.max(next.getTime() - Date.now(), 1000);
  const timerId = window.setTimeout(() => {
    if (shouldRunOnDate(habit) && "Notification" in window && Notification.permission === "granted") {
      new Notification(`Reminder: ${habit.name}`, {
        body: `${buildReminderBody(habit)} Android app par Yes / No / Later actions available hain.`
      });
    }

    logReminderAction({
      habitId: habit.id,
      entryDate: formatDateInput(),
      scheduledFor: next.toISOString(),
      action: "fired",
      source: "web",
      notificationId: `web-${habit.id}-${next.toISOString()}`
    });

    if (typeof onNotify === "function") {
      onNotify({
        kind: "web-reminder-fired",
        habitId: habit.id,
        habitName: habit.name,
        entryDate: formatDateInput(),
        scheduledFor: next.toISOString()
      });
    }

    scheduleWebReminder(habit, onNotify);
  }, delay);

  webReminderTimers.set(habit.id, timerId);
}

export async function ensureReminderPermissions() {
  if (Capacitor.isNativePlatform()) {
    return ensureNativeNotificationsReady();
  }

  if (!("Notification" in window)) {
    return { available: false, permission: "denied" };
  }

  if (Notification.permission === "granted") {
    return { available: true, permission: "granted" };
  }

  const permission = await Notification.requestPermission();
  return { available: permission === "granted", permission };
}

export async function syncHabitReminderNotifications(habits, options = {}) {
  const activeHabits = habits.filter((habit) => habit.reminder_enabled && habit.reminder_time);

  if (Capacitor.isNativePlatform()) {
    const LocalNotifications = await getLocalNotifications();
    if (!LocalNotifications) {
      return { available: false, permission: "denied" };
    }

    const idsToClear = habits.flatMap((habit) => [
      ...normalizeRepeatDays(habit.reminder_repeat_days).map((day) => ({ id: getReminderId(habit.id, day) })),
      { id: getLaterReminderId(habit.id, formatDateInput()) }
    ]);

    await LocalNotifications.cancel({ notifications: idsToClear }).catch(() => {});

    if (!activeHabits.length) {
      return { available: true, permission: "granted" };
    }

    const ready = await ensureNativeNotificationsReady();
    if (!ready.available) {
      return ready;
    }

    const notifications = activeHabits.flatMap((habit) => {
      const [hourText, minuteText] = String(habit.reminder_time).split(":");
      return normalizeRepeatDays(habit.reminder_repeat_days).map((day) => ({
        id: getReminderId(habit.id, day),
        title: `Reminder: ${habit.name}`,
        body: buildReminderBody(habit),
        actionTypeId: ACTION_TYPE_ID,
        channelId: REMINDER_CHANNEL_ID,
        schedule: {
          on: {
            weekday: day + 1,
            hour: Number(hourText),
            minute: Number(minuteText)
          },
          allowWhileIdle: true
        },
        extra: {
          kind: "habit-reminder",
          habitId: habit.id,
          habitName: habit.name,
          repeatDay: day,
          snoozeMinutes: Number(habit.reminder_snooze_minutes || 30)
        }
      }));
    });

    await LocalNotifications.schedule({ notifications });

    activeHabits.forEach((habit) => {
      normalizeRepeatDays(habit.reminder_repeat_days).forEach((day) => {
        logReminderAction({
          habitId: habit.id,
          entryDate: formatDateInput(),
          scheduledFor: null,
          action: "scheduled",
          source: "android",
          notificationId: String(getReminderId(habit.id, day)),
          detail: { repeat_day: day, reminder_time: habit.reminder_time }
        });
      });
    });

    options.onScheduled?.({
      kind: "native-reminders-scheduled",
      count: notifications.length,
      habits: activeHabits.map((habit) => ({
        habitId: habit.id,
        habitName: habit.name,
        repeatDays: normalizeRepeatDays(habit.reminder_repeat_days)
      }))
    });

    return { available: true, permission: ready.permission };
  }

  habits.forEach((habit) => clearWebReminder(habit.id));
  activeHabits.forEach((habit) => scheduleWebReminder(habit, options.onNotify));
  return { available: true, permission: "granted" };
}

export async function scheduleLaterReminder(habit, minutes) {
  const delayMinutes = Number(minutes || habit.reminder_snooze_minutes || 30);

  if (Capacitor.isNativePlatform()) {
    const ready = await ensureNativeNotificationsReady();
    if (!ready.available) {
      return ready;
    }

    const LocalNotifications = await getLocalNotifications();
    const notificationId = getLaterReminderId(habit.id, formatDateInput());
    const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000);
    await LocalNotifications.schedule({
      notifications: [
        {
          id: notificationId,
          title: `Reminder: ${habit.name}`,
          body: buildReminderBody(habit),
          actionTypeId: ACTION_TYPE_ID,
          channelId: REMINDER_CHANNEL_ID,
          schedule: {
            at: scheduledAt,
            allowWhileIdle: true
          },
          extra: {
            kind: "habit-reminder-later",
            habitId: habit.id,
            habitName: habit.name,
            snoozeMinutes: delayMinutes
          }
        }
      ]
    });

    await logReminderAction({
      habitId: habit.id,
      entryDate: formatDateInput(),
      scheduledFor: scheduledAt.toISOString(),
      action: "later",
      source: "android",
      snoozeMinutes: delayMinutes,
      notificationId: String(notificationId)
    });

    return { available: true, permission: ready.permission };
  }

  await logReminderAction({
    habitId: habit.id,
    entryDate: formatDateInput(),
    scheduledFor: new Date(Date.now() + delayMinutes * 60 * 1000).toISOString(),
    action: "later",
    source: "web",
    snoozeMinutes: delayMinutes
  });
  return { available: true, permission: "granted" };
}

export async function clearHabitReminderNotifications(habitId) {
  clearWebReminder(habitId);

  if (!Capacitor.isNativePlatform()) {
    return;
  }

  const LocalNotifications = await getLocalNotifications();
  if (!LocalNotifications) {
    return;
  }

  await LocalNotifications.cancel({
    notifications: [
      ...[0, 1, 2, 3, 4, 5, 6].map((day) => ({ id: getReminderId(habitId, day) })),
      { id: getLaterReminderId(habitId, formatDateInput()) }
    ]
  }).catch(() => {});
}

export async function registerReminderActionListener(onAction) {
  if (actionListenerBound || !Capacitor.isNativePlatform()) {
    return;
  }

  const LocalNotifications = await getLocalNotifications();
  if (!LocalNotifications) {
    return;
  }

  await ensureNativeNotificationsReady();

  LocalNotifications.addListener("localNotificationActionPerformed", async (event) => {
    const extra = event.notification.extra ?? event.notification.data ?? {};
    if (!extra?.habitId) {
      return;
    }

    const actionMap = {
      [ACTION_YES]: "yes",
      [ACTION_NO]: "no",
      [ACTION_LATER]: "later"
    };

    await logReminderAction({
      habitId: extra.habitId,
      entryDate: formatDateInput(),
      scheduledFor: event.notification.schedule?.at?.toISOString?.() ?? null,
      action: actionMap[event.actionId] ?? "fired",
      source: extra.kind ?? "android",
      snoozeMinutes: Number(extra.snoozeMinutes || 30),
      notificationId: String(event.notification.id ?? ""),
      detail: { action_id: event.actionId, repeat_day: extra.repeatDay }
    });

    onAction?.({
      actionId: event.actionId,
      habitId: extra.habitId,
      habitName: extra.habitName,
      repeatDay: extra.repeatDay,
      snoozeMinutes: Number(extra.snoozeMinutes || 30),
      entryDate: formatDateInput(),
      source: extra.kind,
      scheduledFor: event.notification.schedule?.at?.toISOString?.() ?? null,
      notificationId: String(event.notification.id ?? "")
    });
  });

  actionListenerBound = true;
}

export function describeReminder(habit) {
  if (!habit.reminder_enabled || !habit.reminder_time) {
    return "Reminder off";
  }

  const repeatDays = normalizeRepeatDays(habit.reminder_repeat_days);
  const dayLabel = repeatDays.length === 7 ? "Every day" : repeatDays.map((day) => DAY_LABELS[day]).join(", ");
  return `${dayLabel} at ${formatTimeLabel(habit.reminder_time)}`;
}

export const reminderActionIds = {
  yes: ACTION_YES,
  no: ACTION_NO,
  later: ACTION_LATER
};
