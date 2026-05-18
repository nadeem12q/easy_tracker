import { Capacitor } from "@capacitor/core";
import { formatDateInput, formatTimeLabel, hashToInt } from "./lib.js";

const ACTION_TYPE_ID = "habit-reminder-actions";
const ACTION_YES = "habit_yes";
const ACTION_NO = "habit_no";
const ACTION_LATER = "habit_later";
const REMINDER_CHANNEL_ID = "habit-reminders";
const webReminderTimers = new Map();

let pluginPromise = null;
let actionListenerBound = false;
let appListenerBound = false;

async function getLocalNotifications() {
  if (!pluginPromise) {
    pluginPromise = import("@capacitor/local-notifications")
      .then((module) => module.LocalNotifications)
      .catch(() => null);
  }

  return pluginPromise;
}

async function getCapacitorApp() {
  return import("@capacitor/app")
    .then((module) => module.App)
    .catch(() => null);
}

function buildReminderBody(habit) {
  if (habit.reminder_message?.trim()) {
    return habit.reminder_message.trim();
  }

  return `Kya aap ne ${habit.name} complete kar li hai?`;
}

function getReminderId(habitId) {
  return hashToInt(`habit-reminder:${habitId}`);
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

function getNextReminderDate(timeText, offsetMinutes = 0) {
  const [hourText, minuteText] = String(timeText || "").split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }

  const now = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  if (offsetMinutes > 0) {
    next.setTime(Date.now() + offsetMinutes * 60 * 1000);
  }

  return next;
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

async function ensureExactAlarmAccess() {
  const LocalNotifications = await getLocalNotifications();
  if (!LocalNotifications) {
    return { available: false, exact: false };
  }

  if (typeof LocalNotifications.checkExactNotificationSetting !== "function") {
    return { available: true, exact: true };
  }

  const exactSetting = await LocalNotifications.checkExactNotificationSetting().catch(() => null);
  const exact = exactSetting?.value ?? exactSetting?.exact ?? true;

  if (exact || typeof LocalNotifications.changeExactNotificationSetting !== "function") {
    return { available: true, exact };
  }

  await LocalNotifications.changeExactNotificationSetting().catch(() => {});
  return { available: true, exact: false, needsRecheck: true };
}

function scheduleWebReminder(habit, onNotify) {
  clearWebReminder(habit.id);

  if (!habit.reminder_enabled || !habit.reminder_time) {
    return;
  }

  const next = getNextReminderDate(habit.reminder_time);
  if (!next) {
    return;
  }

  const delay = Math.max(next.getTime() - Date.now(), 1000);
  const timerId = window.setTimeout(() => {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`Reminder: ${habit.name}`, {
        body: `${buildReminderBody(habit)} Android app par Yes / No / Later actions available hain.`
      });
    }

    if (typeof onNotify === "function") {
      onNotify({
        kind: "web-reminder-fired",
        habitId: habit.id,
        habitName: habit.name
      });
    }

    scheduleWebReminder(habit, onNotify);
  }, delay);

  webReminderTimers.set(habit.id, timerId);
}

export async function ensureReminderPermissions() {
  if (Capacitor.isNativePlatform()) {
    const ready = await ensureNativeNotificationsReady();
    if (!ready.available) {
      return ready;
    }

    const exact = await ensureExactAlarmAccess();
    return {
      ...ready,
      exact
    };
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
      { id: getReminderId(habit.id) },
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

    await LocalNotifications.schedule({
      notifications: activeHabits.map((habit) => {
        const [hourText, minuteText] = String(habit.reminder_time).split(":");
        return {
          id: getReminderId(habit.id),
          title: `Reminder: ${habit.name}`,
          body: buildReminderBody(habit),
          actionTypeId: ACTION_TYPE_ID,
          channelId: REMINDER_CHANNEL_ID,
          schedule: {
            on: {
              hour: Number(hourText),
              minute: Number(minuteText)
            },
            allowWhileIdle: true
          },
          extra: {
            kind: "habit-reminder",
            habitId: habit.id,
            habitName: habit.name,
            snoozeMinutes: Number(habit.reminder_snooze_minutes || 30)
          }
        };
      })
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
    await LocalNotifications.schedule({
      notifications: [
        {
          id: getLaterReminderId(habit.id, formatDateInput()),
          title: `Reminder: ${habit.name}`,
          body: buildReminderBody(habit),
          actionTypeId: ACTION_TYPE_ID,
          channelId: REMINDER_CHANNEL_ID,
          schedule: {
            at: new Date(Date.now() + delayMinutes * 60 * 1000),
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
    return { available: true, permission: ready.permission };
  }

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
      { id: getReminderId(habitId) },
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

  LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
    const extra = event.notification.extra ?? event.notification.data ?? {};
    if (!extra?.habitId) {
      return;
    }

    onAction?.({
      actionId: event.actionId,
      habitId: extra.habitId,
      habitName: extra.habitName,
      snoozeMinutes: Number(extra.snoozeMinutes || 30),
      entryDate: formatDateInput(),
      source: extra.kind
    });
  });

  actionListenerBound = true;
}

export async function registerReminderAppStateListener(onResume) {
  if (appListenerBound || !Capacitor.isNativePlatform()) {
    return;
  }

  const App = await getCapacitorApp();
  if (!App) {
    return;
  }

  App.addListener("appStateChange", async ({ isActive }) => {
    if (!isActive) {
      return;
    }

    onResume?.();
  });

  appListenerBound = true;
}

export function describeReminder(habit) {
  if (!habit.reminder_enabled || !habit.reminder_time) {
    return "Reminder off";
  }

  return `Daily at ${formatTimeLabel(habit.reminder_time)}`;
}

export const reminderActionIds = {
  yes: ACTION_YES,
  no: ACTION_NO,
  later: ACTION_LATER
};
