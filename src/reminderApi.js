import { listHabits, updateHabitReminder } from "./api.js";
import { normalizeRepeatDays as normalizeDays } from "./lib.js";
import { getSupabaseClient, hasSupabaseConfig } from "./supabase.js";

async function getSessionUser() {
  if (!hasSupabaseConfig) return null;
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.user ?? null;
}

export function normalizeRepeatDays(days) {
  return normalizeDays(days);
}

export async function listReminderHabits() {
  return listHabits();
}

export async function saveHabitReminderAdvanced(habitId, patch) {
  const normalized = {
    reminder_enabled: Boolean(patch.reminder_enabled),
    reminder_time: patch.reminder_enabled ? patch.reminder_time || null : null,
    reminder_message: patch.reminder_message ?? "",
    reminder_snooze_minutes: Number(patch.reminder_snooze_minutes ?? 30),
    reminder_repeat_days: normalizeRepeatDays(patch.reminder_repeat_days)
  };

  if (!hasSupabaseConfig || !(await getSessionUser())) {
    return updateHabitReminder(habitId, normalized);
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("user_habits")
    .update(normalized)
    .eq("id", habitId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function logReminderAction({
  habitId,
  entryDate,
  scheduledFor,
  action,
  source = "app",
  snoozeMinutes,
  notificationId,
  detail = {}
}) {
  if (!hasSupabaseConfig || !(await getSessionUser())) {
    return null;
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("reminder_logs")
    .insert({
      habit_id: habitId,
      entry_date: entryDate,
      scheduled_for: scheduledFor ?? null,
      action,
      source,
      snooze_minutes: snoozeMinutes ?? null,
      notification_id: notificationId ?? null,
      detail
    })
    .select("*")
    .single();

  if (error) {
    console.warn("Reminder log failed", error.message);
    return null;
  }

  return data;
}

export async function listReminderLogs(limit = 30) {
  if (!hasSupabaseConfig || !(await getSessionUser())) return [];

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("reminder_log_view")
    .select("id,habit_id,habit_name,entry_date,scheduled_for,action,source,snooze_minutes,notification_id,detail,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function getReminderStats(days = 14) {
  if (!hasSupabaseConfig || !(await getSessionUser())) {
    return { days, logs: [], summary: {} };
  }

  const supabase = await getSupabaseClient();
  const since = new Date();
  since.setDate(since.getDate() - Math.max(1, Number(days)));

  const { data, error } = await supabase
    .from("reminder_log_view")
    .select("id,habit_id,habit_name,entry_date,action,created_at")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false });

  if (error) throw error;

  const summary = {};
  (data ?? []).forEach((log) => {
    const key = log.habit_name || log.habit_id;
    if (!summary[key]) {
      summary[key] = { scheduled: 0, fired: 0, yes: 0, no: 0, later: 0, missed: 0 };
    }
    if (summary[key][log.action] !== undefined) {
      summary[key][log.action] += 1;
    }
  });

  return { days, logs: data ?? [], summary };
}
