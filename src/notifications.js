import { Capacitor } from "@capacitor/core";
import {
  formatDateInput,
  formatTimeLabel,
  getNextDateForRepeatDays,
  hashToInt,
  normalizeRepeatDays
} from "./lib.js";
import { logReminderAction } from "./reminderApi.js";

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

function getReminderId(habitId, day = "daily") {
  return hashToInt(`habit-reminder:${habitId}:${day}`);
}

function getReminderIds(habit) {
  return normalizeRepeatDays(habit.reminder_repeat_days).map((day) => ({
    id: getReminderId(habit.id, day),
    day
  }));
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

  const next = getNextDateForRepeatDays(habit.reminder_time, habit.reminder_repeat_days);
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

    logReminderAction({
      habitId: habit.id,
      entryDate: formatDateInput(),
      scheduledFor: next.toISOString(),
      action: "fired",
      source: "web"
    });

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
      ...getReminderIds(habit).map(({ id }) => ({ id })),
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
        const hour = Number(hourText);
        const minute = Number(minuteText);

        return getReminderIds(habit).map(({ id, day }) => ({
          id,
          title: `Reminder: ${habit.name}`,
          body: buildReminderBody(habit),
          actionTypeId: ACTION_TYPE_ID,
          channelId: REMINDER_CHANNEL_ID,
          schedule: {
            on: {
              weekday: day === 0 ? 1 : day + 1,
              hour,
              minute
            },
            repeats: true,
            allowWhileIdle: true
          },
          extra: {
            kind: "habit-reminder",
            habitId: habit.id,
            habitName: habit.name,
            reminderDay: day,
            snoozeMinutes: Number(habit.reminder_snooze_minutes || 30)
          }
        }));
      });

    await LocalNotifications.schedule({
      notifications
    });

    await Promise.all(
      activeHabits.map((habit) => {
        const scheduledFor = getNextDateForRepeatDays(habit.reminder_time, habit.reminder_repeat_days);
        return logReminderAction({
          habitId: habit.id,
          entryDate: formatDateInput(scheduledFor ?? new Date()),
          scheduledFor: scheduledFor?.toISOString(),
          action: "scheduled",
          source: "android",
          detail: { repeat_days: normalizeRepeatDays(habit.reminder_repeat_days) }
        });
      })
    );

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
    const scheduledFor = getNextDateForRepeatDays(habit.reminder_time, habit.reminder_repeat_days, delayMinutes);
    await LocalNotifications.schedule({
      notifications: [
        {
          id: getLaterReminderId(habit.id, formatDateInput()),
          title: `Reminder: ${habit.name}`,
          body: buildReminderBody(habit),
          actionTypeId: ACTION_TYPE_ID,
          channelId: REMINDER_CHANNEL_ID,
          schedule: {
            at: scheduledFor,
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
      entryDate: formatDateInput(scheduledFor),
      scheduledFor: scheduledFor.toISOString(),
      action: "later",
      source: "android",
      snoozeMinutes: delayMinutes
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
      ...normalizeRepeatDays().map((day) => ({ id: getReminderId(habitId, day) })),
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

    const actionMap = {
      [ACTION_YES]: "yes",
      [ACTION_NO]: "no",
      [ACTION_LATER]: "later"
    };

    if (actionMap[event.actionId]) {
      logReminderAction({
        habitId: extra.habitId,
        entryDate: formatDateInput(),
        action: actionMap[event.actionId],
        source: "android",
        snoozeMinutes: Number(extra.snoozeMinutes || 30),
        detail: { notification_kind: extra.kind }
      });
    }
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

  const repeatDays = normalizeRepeatDays(habit.reminder_repeat_days);
  const dayLabel = repeatDays.length === 7 ? "Daily" : `${repeatDays.length} days/week`;
  return `${dayLabel} at ${formatTimeLabel(habit.reminder_time)}`;
}

export const reminderActionIds = {
  yes: ACTION_YES,
  no: ACTION_NO,
  later: ACTION_LATER
};
