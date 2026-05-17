import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-mcp-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function startOfDay(dateText: string) {
  return new Date(`${dateText}T00:00:00Z`);
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(dateText: string, offsetDays: number) {
  const date = startOfDay(dateText);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return formatDate(date);
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

function calculateSleepDuration(sleepTime?: string | null, wakeTime?: string | null) {
  if (!sleepTime || !wakeTime) {
    return { minutes: null, label: "" };
  }

  const [sleepHour, sleepMinute] = sleepTime.split(":").map(Number);
  const [wakeHour, wakeMinute] = wakeTime.split(":").map(Number);

  if ([sleepHour, sleepMinute, wakeHour, wakeMinute].some((item) => Number.isNaN(item))) {
    return { minutes: null, label: "" };
  }

  let sleepMinutes = sleepHour * 60 + sleepMinute;
  let wakeMinutes = wakeHour * 60 + wakeMinute;
  if (wakeMinutes <= sleepMinutes) {
    wakeMinutes += 24 * 60;
  }

  const total = wakeMinutes - sleepMinutes;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return {
    minutes: total,
    label: `${hours}h ${minutes}m`
  };
}

async function logAudit({
  userId,
  tokenId,
  action,
  clientName,
  success,
  detail,
  errorMessage
}: {
  userId: string;
  tokenId: string | null;
  action: string;
  clientName?: string | null;
  success: boolean;
  detail?: Record<string, unknown>;
  errorMessage?: string | null;
}) {
  await admin.from("mcp_audit_logs").insert({
    user_id: userId,
    token_id: tokenId,
    action,
    client_name: clientName ?? null,
    success,
    detail: detail ?? {},
    error_message: errorMessage ?? null
  });
}

async function authenticateToken(request: Request) {
  const header =
    request.headers.get("x-mcp-token") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  if (!header) {
    throw new Error("Missing MCP token.");
  }

  const rawToken = header.startsWith("mtk_") ? header.slice(4) : header;
  const tokenHash = await sha256Hex(rawToken);

  const { data: tokenRow, error } = await admin
    .from("mcp_api_tokens")
    .select("id,user_id,label,can_write,can_analyze,expires_at,revoked_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (error || !tokenRow) {
    throw new Error("Invalid or expired MCP token.");
  }

  await admin
    .from("mcp_api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tokenRow.id);

  return tokenRow;
}

async function getHabits(userId: string) {
  const { data, error } = await admin
    .from("user_habits")
    .select("id,name,slug,category,color,position,is_archived")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("position", { ascending: true });

  if (error) throw error;
  return data;
}

async function getDailyEntry(userId: string, entryDate: string) {
  const { data, error } = await admin
    .from("daily_entries")
    .select("*")
    .eq("user_id", userId)
    .eq("entry_date", entryDate)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function createOrGetDailyEntry(userId: string, entryDate: string) {
  const existing = await getDailyEntry(userId, entryDate);
  if (existing) return existing;

  const { data, error } = await admin
    .from("daily_entries")
    .insert({ user_id: userId, entry_date: entryDate })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

async function upsertDailyEntry(userId: string, entryDate: string, patch: Record<string, unknown>) {
  const current = await createOrGetDailyEntry(userId, entryDate);
  const duration = calculateSleepDuration(
    String((patch.sleep_time ?? current.sleep_time ?? "") || ""),
    String((patch.wake_time ?? current.wake_time ?? "") || "")
  );

  const payload = {
    ...current,
    ...patch,
    user_id: userId,
    entry_date: entryDate,
    sleep_duration_minutes: duration.minutes,
    sleep_duration_label: duration.label
  };

  const { data, error } = await admin
    .from("daily_entries")
    .upsert(payload, { onConflict: "user_id,entry_date" })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

async function getEntriesBetween(userId: string, startDate: string, endDate: string) {
  const { data, error } = await admin
    .from("daily_entries")
    .select(
      "id,entry_date,mood_key,mood_label,day_rating,sleep_time,wake_time,sleep_quality,screen_time,sleep_duration_minutes,sleep_duration_label,gratitude,review,best_moment,improved_today,goals_achieved,still_working_on,focus_for_tomorrow,intentions_for_tomorrow"
    )
    .eq("user_id", userId)
    .gte("entry_date", startDate)
    .lte("entry_date", endDate)
    .order("entry_date", { ascending: true });

  if (error) throw error;
  return data;
}

async function getLogsForEntryIds(entryIds: string[]) {
  if (!entryIds.length) return [];
  const { data, error } = await admin
    .from("daily_habit_logs")
    .select("entry_id,habit_id,done")
    .in("entry_id", entryIds);

  if (error) throw error;
  return data;
}

function summarizeReflectionText(entries: Record<string, unknown>[]) {
  const buckets = {
    gratitude_mentions: 0,
    review_mentions: 0,
    best_moment_mentions: 0,
    improvement_mentions: 0,
    goals_mentions: 0,
    tomorrow_focus_mentions: 0
  };

  entries.forEach((entry) => {
    if (String(entry.gratitude ?? "").trim()) buckets.gratitude_mentions += 1;
    if (String(entry.review ?? "").trim()) buckets.review_mentions += 1;
    if (String(entry.best_moment ?? "").trim()) buckets.best_moment_mentions += 1;
    if (String(entry.improved_today ?? "").trim()) buckets.improvement_mentions += 1;
    if (String(entry.goals_achieved ?? "").trim() || String(entry.still_working_on ?? "").trim()) {
      buckets.goals_mentions += 1;
    }
    if (String(entry.focus_for_tomorrow ?? "").trim() || String(entry.intentions_for_tomorrow ?? "").trim()) {
      buckets.tomorrow_focus_mentions += 1;
    }
  });

  return buckets;
}

function average(numbers: number[]) {
  if (!numbers.length) return 0;
  return numbers.reduce((sum, item) => sum + item, 0) / numbers.length;
}

function buildHabitConsistency(habits: any[], entries: any[], logs: any[], requestedDays: number) {
  const grouped = new Map();

  habits.forEach((habit) => {
    grouped.set(habit.id, {
      habit_id: habit.id,
      habit_name: habit.name,
      days_done: 0,
      completion_rate: 0,
      current_streak: 0,
      best_streak: 0
    });
  });

  logs.forEach((log) => {
    if (!log.done || !grouped.has(log.habit_id)) return;
    grouped.get(log.habit_id).days_done += 1;
  });

  habits.forEach((habit) => {
    const item = grouped.get(habit.id);
    item.completion_rate = requestedDays
      ? Number(((item.days_done / requestedDays) * 100).toFixed(1))
      : 0;

    const datesDone = entries
      .filter((entry) =>
        logs.some((log) => log.entry_id === entry.id && log.habit_id === habit.id && log.done)
      )
      .map((entry) => entry.entry_date);

    let current = 0;
    let best = 0;
    let running = 0;
    let previousDate: string | null = null;

    datesDone.forEach((dateText) => {
      if (!previousDate) {
        running = 1;
      } else {
        const expectedPrev = shiftDate(dateText, -1);
        running = previousDate === expectedPrev ? running + 1 : 1;
      }

      best = Math.max(best, running);
      previousDate = dateText;
    });

    const today = entries[entries.length - 1]?.entry_date;
    if (today) {
      let cursor = today;
      while (datesDone.includes(cursor)) {
        current += 1;
        cursor = shiftDate(cursor, -1);
      }
    }

    item.current_streak = current;
    item.best_streak = best;
  });

  return Array.from(grouped.values()).sort((a, b) => b.completion_rate - a.completion_rate);
}

function buildMissedHabitsReport(habits: any[], logs: any[], entryId: string) {
  const doneMap = new Map(
    logs.filter((log) => log.entry_id === entryId).map((log) => [log.habit_id, Boolean(log.done)])
  );

  return habits
    .filter((habit) => !doneMap.get(habit.id))
    .map((habit) => ({
      habit_id: habit.id,
      habit_name: habit.name,
      category: habit.category
    }));
}

function buildTopStrugglesReport(consistencyRows: any[], limit = 5) {
  return [...consistencyRows]
    .sort((a, b) => {
      if (a.completion_rate !== b.completion_rate) return a.completion_rate - b.completion_rate;
      return a.current_streak - b.current_streak;
    })
    .slice(0, limit);
}

function buildRecommendedFocus(consistencyRows: any[], reflectionSummary: any, latestEntry: any) {
  const weakHabits = buildTopStrugglesReport(consistencyRows, 3);
  const suggestions: string[] = [];

  weakHabits.forEach((habit) => {
    suggestions.push(`Kal ${habit.habit_name} par khas focus rakhein.`);
  });

  if ((reflectionSummary.improvement_mentions ?? 0) === 0) {
    suggestions.push("Kal ek chhota improvement note zaroor likhein.");
  }
  if ((reflectionSummary.gratitude_mentions ?? 0) === 0) {
    suggestions.push("Kal gratitude section bharne ki niyyat rakhein.");
  }
  if (!latestEntry?.sleep_duration_minutes || latestEntry.sleep_duration_minutes < 420) {
    suggestions.push("Kal sleep routine ko stabilize karne ki koshish karein.");
  }

  return {
    based_on_habits: weakHabits,
    suggestions: suggestions.slice(0, 5)
  };
}

function buildStreakRiskReport(consistencyRows: any[]) {
  return consistencyRows
    .filter((habit) => habit.completion_rate < 60 || habit.current_streak === 0)
    .map((habit) => {
      let risk_level = "medium";
      if (habit.completion_rate < 35 || habit.current_streak === 0) {
        risk_level = "high";
      } else if (habit.completion_rate >= 60 && habit.current_streak <= 1) {
        risk_level = "low";
      }

      return {
        habit_id: habit.habit_id,
        habit_name: habit.habit_name,
        completion_rate: habit.completion_rate,
        current_streak: habit.current_streak,
        best_streak: habit.best_streak,
        risk_level
      };
    })
    .sort((a, b) => {
      const weight = { high: 0, medium: 1, low: 2 } as Record<string, number>;
      if (weight[a.risk_level] !== weight[b.risk_level]) {
        return weight[a.risk_level] - weight[b.risk_level];
      }
      return a.completion_rate - b.completion_rate;
    });
}

function completionRateForEntry(entry: any, logs: any[], habits: any[]) {
  if (!entry || !habits.length) return 0;
  const doneCount = logs.filter((log) => log.entry_id === entry.id && log.done).length;
  return Number(((doneCount / habits.length) * 100).toFixed(1));
}

function buildMissingFieldList(entry: any) {
  const missing: string[] = [];
  if (!entry?.sleep_time) missing.push("sleep_time");
  if (!entry?.wake_time) missing.push("wake_time");
  if (!entry?.sleep_quality) missing.push("sleep_quality");
  if (!String(entry?.screen_time ?? "").trim()) missing.push("screen_time");
  if (!entry?.mood_key) missing.push("mood");
  if (!entry?.day_rating) missing.push("day_rating");
  if (!String(entry?.gratitude ?? "").trim()) missing.push("gratitude");
  if (!String(entry?.review ?? "").trim()) missing.push("review");
  if (!String(entry?.focus_for_tomorrow ?? "").trim() && !String(entry?.intentions_for_tomorrow ?? "").trim()) {
    missing.push("tomorrow_focus");
  }
  return missing;
}

function buildDailyGapAnalysis(entry: any, habits: any[], logs: any[]) {
  const completionRate = completionRateForEntry(entry, logs, habits);
  const missedHabits = buildMissedHabitsReport(habits, logs, entry.id);
  const missingFields = buildMissingFieldList(entry);

  let status = "strong";
  if (completionRate < 40 || missingFields.length >= 5) status = "needs_attention";
  else if (completionRate < 70 || missingFields.length >= 2) status = "in_progress";

  return {
    entry_date: entry.entry_date,
    completion_rate: completionRate,
    done_habits: habits.length - missedHabits.length,
    total_habits: habits.length,
    missed_habits: missedHabits,
    missing_fields: missingFields,
    sleep_logged: Boolean(entry.sleep_time && entry.wake_time),
    reflection_logged: Boolean(
      String(entry.gratitude ?? "").trim() || String(entry.review ?? "").trim() || String(entry.best_moment ?? "").trim()
    ),
    status
  };
}

function buildMomentumReport(currentEntries: any[], previousEntries: any[], currentLogs: any[], previousLogs: any[], habits: any[]) {
  const currentDone = currentLogs.filter((log) => log.done).length;
  const previousDone = previousLogs.filter((log) => log.done).length;
  const currentHabitSlots = currentEntries.length * Math.max(habits.length, 1);
  const previousHabitSlots = previousEntries.length * Math.max(habits.length, 1);

  const currentCompletion = currentHabitSlots ? Number(((currentDone / currentHabitSlots) * 100).toFixed(1)) : 0;
  const previousCompletion = previousHabitSlots ? Number(((previousDone / previousHabitSlots) * 100).toFixed(1)) : 0;

  const currentRatings = currentEntries.map((entry) => entry.day_rating).filter(Boolean);
  const previousRatings = previousEntries.map((entry) => entry.day_rating).filter(Boolean);
  const currentSleep = currentEntries.map((entry) => entry.sleep_duration_minutes).filter((value) => Number.isFinite(value));
  const previousSleep = previousEntries.map((entry) => entry.sleep_duration_minutes).filter((value) => Number.isFinite(value));

  const currentReflection = summarizeReflectionText(currentEntries);
  const previousReflection = summarizeReflectionText(previousEntries);

  return {
    current_window: {
      entries: currentEntries.length,
      habit_completion_rate: currentCompletion,
      average_day_rating: Number(average(currentRatings).toFixed(2)),
      average_sleep_minutes: Math.round(average(currentSleep)),
      reflection_activity: currentReflection
    },
    previous_window: {
      entries: previousEntries.length,
      habit_completion_rate: previousCompletion,
      average_day_rating: Number(average(previousRatings).toFixed(2)),
      average_sleep_minutes: Math.round(average(previousSleep)),
      reflection_activity: previousReflection
    },
    change: {
      habit_completion_rate: Number((currentCompletion - previousCompletion).toFixed(1)),
      average_day_rating: Number((average(currentRatings) - average(previousRatings)).toFixed(2)),
      average_sleep_minutes: Math.round(average(currentSleep) - average(previousSleep)),
      gratitude_activity: currentReflection.gratitude_mentions - previousReflection.gratitude_mentions,
      review_activity: currentReflection.review_mentions - previousReflection.review_mentions
    }
  };
}

function buildCoachingBrief(consistencyRows: any[], reflectionSummary: any, entries: any[], momentumReport: any) {
  const latestEntry = entries[entries.length - 1] ?? null;
  const strongest = [...consistencyRows].sort((a, b) => b.completion_rate - a.completion_rate).slice(0, 3);
  const weakest = buildTopStrugglesReport(consistencyRows, 3);
  const focus = buildRecommendedFocus(consistencyRows, reflectionSummary, latestEntry);

  const moodCounts: Record<string, number> = {};
  entries.forEach((entry) => {
    if (entry.mood_key) moodCounts[entry.mood_key] = (moodCounts[entry.mood_key] ?? 0) + 1;
  });

  const topMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const direction =
    momentumReport.change.habit_completion_rate > 5
      ? "improving"
      : momentumReport.change.habit_completion_rate < -5
        ? "slipping"
        : "stable";

  return {
    direction,
    top_mood: topMood,
    strongest_habits: strongest,
    weak_habits: weakest,
    reflection_summary: reflectionSummary,
    suggestions: focus.suggestions,
    plain_summary:
      direction === "improving"
        ? "Recent pattern behtar lag raha hai. Momentum ko simple routines ke saath carry forward karein."
        : direction === "slipping"
          ? "Recent pattern thora slip kar raha hai. Kal ke liye kam habits par focus rakhna zyada behtar hoga."
          : "Pattern kaafi stable hai. Ab quality aur consistency dono ko barha sakte hain."
  };
}

async function upsertHabitLogs(entryId: string, habitRows: { habit_id: string; done: boolean }[]) {
  if (!habitRows.length) return;
  const payload = habitRows.map((row) => ({ entry_id: entryId, habit_id: row.habit_id, done: row.done }));
  const { error } = await admin
    .from("daily_habit_logs")
    .upsert(payload, { onConflict: "entry_id,habit_id" });
  if (error) throw error;
}

async function handleAction(userId: string, action: string, args: Record<string, any>) {
  switch (action) {
    case "who_am_i": {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error) throw error;
      return { user_id: userId, email: data.user?.email ?? null };
    }
    case "get_today_dashboard": {
      const entry = await createOrGetDailyEntry(userId, args.entry_date);
      const habits = await getHabits(userId);
      const { data: logs, error } = await admin
        .from("daily_habit_logs")
        .select("habit_id,done")
        .eq("entry_id", entry.id);
      if (error) throw error;
      return { entry, habits, logs };
    }
    case "mark_habits": {
      const entry = await createOrGetDailyEntry(userId, args.entry_date);
      const habits = await getHabits(userId);
      const picked = habits.filter((habit) =>
        (args.habit_names ?? []).some((name: string) => name.toLowerCase() === habit.name.toLowerCase())
      );
      if (!picked.length) throw new Error("Koi matching habit nahin mili.");
      await upsertHabitLogs(entry.id, picked.map((habit) => ({ habit_id: habit.id, done: args.done })));
      return { entry_date: args.entry_date, updated_habits: picked.map((habit) => habit.name), done: args.done };
    }
    case "update_reflection":
      return upsertDailyEntry(userId, args.entry_date, args.patch ?? {});
    case "set_sleep":
      return upsertDailyEntry(userId, args.entry_date, { sleep_time: args.sleep_time, wake_time: args.wake_time });
    case "set_mood": {
      const entry = await createOrGetDailyEntry(userId, args.entry_date);
      return upsertDailyEntry(userId, args.entry_date, {
        mood_key: args.mood_key ?? entry.mood_key,
        day_rating: args.day_rating ?? entry.day_rating
      });
    }
    case "weekly_summary": {
      const { data, error } = await admin
        .from("daily_entries")
        .select("entry_date,mood_key,day_rating,sleep_duration_label")
        .eq("user_id", userId)
        .lte("entry_date", args.end_date)
        .order("entry_date", { ascending: false })
        .limit(7);
      if (error) throw error;
      return { entries: data };
    }
    case "habit_consistency_report": {
      const days = Math.max(1, Math.min(args.days ?? 14, 90));
      const startDate = shiftDate(args.end_date, -(days - 1));
      const [habits, entries] = await Promise.all([getHabits(userId), getEntriesBetween(userId, startDate, args.end_date)]);
      const logs = await getLogsForEntryIds(entries.map((entry) => entry.id));
      return { start_date: startDate, end_date: args.end_date, days, habits: buildHabitConsistency(habits, entries, logs, days) };
    }
    case "reflection_pattern_report": {
      const days = Math.max(1, Math.min(args.days ?? 14, 90));
      const startDate = shiftDate(args.end_date, -(days - 1));
      const entries = await getEntriesBetween(userId, startDate, args.end_date);
      const moodCounts: Record<string, number> = {};
      let ratedDays = 0;
      let totalRating = 0;
      let sleepTrackedDays = 0;
      let totalSleepMinutes = 0;
      entries.forEach((entry) => {
        if (entry.mood_key) moodCounts[entry.mood_key] = (moodCounts[entry.mood_key] ?? 0) + 1;
        if (entry.day_rating) {
          ratedDays += 1;
          totalRating += entry.day_rating;
        }
        if (entry.sleep_duration_minutes) {
          sleepTrackedDays += 1;
          totalSleepMinutes += entry.sleep_duration_minutes;
        }
      });
      return {
        start_date: startDate,
        end_date: args.end_date,
        days,
        total_entries: entries.length,
        mood_counts: moodCounts,
        average_day_rating: ratedDays ? Number((totalRating / ratedDays).toFixed(2)) : 0,
        average_sleep_minutes: sleepTrackedDays ? Math.round(totalSleepMinutes / sleepTrackedDays) : 0,
        reflection_activity: summarizeReflectionText(entries)
      };
    }
    case "missed_habits_report": {
      const [entry, habits] = await Promise.all([createOrGetDailyEntry(userId, args.entry_date), getHabits(userId)]);
      const { data: logs, error } = await admin
        .from("daily_habit_logs")
        .select("entry_id,habit_id,done")
        .eq("entry_id", entry.id);
      if (error) throw error;
      return { entry_date: args.entry_date, missed_habits: buildMissedHabitsReport(habits, logs, entry.id) };
    }
    case "top_struggles_report": {
      const days = Math.max(1, Math.min(args.days ?? 14, 90));
      const startDate = shiftDate(args.end_date, -(days - 1));
      const [habits, entries] = await Promise.all([getHabits(userId), getEntriesBetween(userId, startDate, args.end_date)]);
      const logs = await getLogsForEntryIds(entries.map((entry) => entry.id));
      const consistencyRows = buildHabitConsistency(habits, entries, logs, days);
      return { start_date: startDate, end_date: args.end_date, days, struggles: buildTopStrugglesReport(consistencyRows, args.limit ?? 5) };
    }
    case "recommended_focus_for_tomorrow": {
      const days = Math.max(1, Math.min(args.days ?? 14, 90));
      const startDate = shiftDate(args.end_date, -(days - 1));
      const [habits, entries] = await Promise.all([getHabits(userId), getEntriesBetween(userId, startDate, args.end_date)]);
      const logs = await getLogsForEntryIds(entries.map((entry) => entry.id));
      const consistencyRows = buildHabitConsistency(habits, entries, logs, days);
      const reflectionSummary = summarizeReflectionText(entries);
      const latestEntry = entries[entries.length - 1] ?? null;
      return { start_date: startDate, end_date: args.end_date, days, ...buildRecommendedFocus(consistencyRows, reflectionSummary, latestEntry) };
    }
    case "capture_day_update": {
      const entry = await createOrGetDailyEntry(userId, args.entry_date);
      const habits = await getHabits(userId);
      const byName = new Map(habits.map((habit) => [habit.name.toLowerCase(), habit]));
      const doneNames = args.done_habits ?? [];
      const undoneNames = args.undone_habits ?? [];
      const doneHabits = doneNames.map((name: string) => byName.get(name.toLowerCase().trim())).filter(Boolean);
      const undoneHabits = undoneNames.map((name: string) => byName.get(name.toLowerCase().trim())).filter(Boolean);
      const unmatchedDone = doneNames.filter((name: string) => !byName.has(name.toLowerCase().trim()));
      const unmatchedUndone = undoneNames.filter((name: string) => !byName.has(name.toLowerCase().trim()));
      await upsertHabitLogs(entry.id, [
        ...doneHabits.map((habit: any) => ({ habit_id: habit.id, done: true })),
        ...undoneHabits.map((habit: any) => ({ habit_id: habit.id, done: false }))
      ]);
      const updatedEntry = await upsertDailyEntry(userId, args.entry_date, {
        ...(args.patch ?? {}),
        ...(args.sleep_time ? { sleep_time: args.sleep_time } : {}),
        ...(args.wake_time ? { wake_time: args.wake_time } : {}),
        ...(args.mood_key ? { mood_key: args.mood_key } : {}),
        ...(Number.isInteger(args.day_rating) ? { day_rating: args.day_rating } : {}),
        ...(args.screen_time ? { screen_time: args.screen_time } : {})
      });
      return {
        entry_date: args.entry_date,
        updated_entry_id: updatedEntry.id,
        done_habits: doneHabits.map((habit: any) => habit.name),
        undone_habits: undoneHabits.map((habit: any) => habit.name),
        unmatched_habit_names: [...unmatchedDone, ...unmatchedUndone]
      };
    }
    case "daily_gap_analysis": {
      const [entry, habits] = await Promise.all([createOrGetDailyEntry(userId, args.entry_date), getHabits(userId)]);
      const { data: logs, error } = await admin
        .from("daily_habit_logs")
        .select("entry_id,habit_id,done")
        .eq("entry_id", entry.id);
      if (error) throw error;
      return buildDailyGapAnalysis(entry, habits, logs);
    }
    case "streak_risk_report": {
      const days = Math.max(3, Math.min(args.days ?? 14, 90));
      const startDate = shiftDate(args.end_date, -(days - 1));
      const [habits, entries] = await Promise.all([getHabits(userId), getEntriesBetween(userId, startDate, args.end_date)]);
      const logs = await getLogsForEntryIds(entries.map((entry) => entry.id));
      const consistencyRows = buildHabitConsistency(habits, entries, logs, days);
      return { start_date: startDate, end_date: args.end_date, days, risks: buildStreakRiskReport(consistencyRows) };
    }
    case "momentum_report": {
      const windowDays = Math.max(3, Math.min(args.window_days ?? 7, 30));
      const currentStartDate = shiftDate(args.end_date, -(windowDays - 1));
      const previousEndDate = shiftDate(currentStartDate, -1);
      const previousStartDate = shiftDate(previousEndDate, -(windowDays - 1));
      const habits = await getHabits(userId);
      const [currentEntries, previousEntries] = await Promise.all([
        getEntriesBetween(userId, currentStartDate, args.end_date),
        getEntriesBetween(userId, previousStartDate, previousEndDate)
      ]);
      const [currentLogs, previousLogs] = await Promise.all([
        getLogsForEntryIds(currentEntries.map((entry) => entry.id)),
        getLogsForEntryIds(previousEntries.map((entry) => entry.id))
      ]);
      return {
        current_start_date: currentStartDate,
        current_end_date: args.end_date,
        previous_start_date: previousStartDate,
        previous_end_date: previousEndDate,
        window_days: windowDays,
        ...buildMomentumReport(currentEntries, previousEntries, currentLogs, previousLogs, habits)
      };
    }
    case "coaching_brief": {
      const days = Math.max(3, Math.min(args.days ?? 14, 90));
      const startDate = shiftDate(args.end_date, -(days - 1));
      const previousEndDate = shiftDate(startDate, -1);
      const previousStartDate = shiftDate(previousEndDate, -(days - 1));
      const [habits, entries, previousEntries] = await Promise.all([
        getHabits(userId),
        getEntriesBetween(userId, startDate, args.end_date),
        getEntriesBetween(userId, previousStartDate, previousEndDate)
      ]);
      const [logs, previousLogs] = await Promise.all([
        getLogsForEntryIds(entries.map((entry) => entry.id)),
        getLogsForEntryIds(previousEntries.map((entry) => entry.id))
      ]);
      const consistencyRows = buildHabitConsistency(habits, entries, logs, days);
      const reflectionSummary = summarizeReflectionText(entries);
      const momentum = buildMomentumReport(entries, previousEntries, logs, previousLogs, habits);
      return { start_date: startDate, end_date: args.end_date, days, ...buildCoachingBrief(consistencyRows, reflectionSummary, entries, momentum) };
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let tokenInfo: { id: string; user_id: string; can_write: boolean; can_analyze: boolean } | null = null;
  let body: Record<string, any> = {};

  try {
    tokenInfo = await authenticateToken(request);
    body = await request.json();
    const action = String(body.action ?? "");
    const args = body.args ?? {};
    const clientName = body.client_name ?? "mcp-client";

    const writeActions = new Set([
      "mark_habits",
      "update_reflection",
      "set_sleep",
      "set_mood",
      "capture_day_update"
    ]);
    const analysisActions = new Set([
      "weekly_summary",
      "habit_consistency_report",
      "reflection_pattern_report",
      "missed_habits_report",
      "top_struggles_report",
      "recommended_focus_for_tomorrow",
      "daily_gap_analysis",
      "streak_risk_report",
      "momentum_report",
      "coaching_brief"
    ]);

    if (writeActions.has(action) && !tokenInfo.can_write) {
      throw new Error("Is MCP token ko write access hasil nahin hai.");
    }
    if (analysisActions.has(action) && !tokenInfo.can_analyze) {
      throw new Error("Is MCP token ko analysis access hasil nahin hai.");
    }

    const result = await handleAction(tokenInfo.user_id, action, args);
    await logAudit({
      userId: tokenInfo.user_id,
      tokenId: tokenInfo.id,
      action,
      clientName,
      success: true,
      detail: { args_keys: Object.keys(args ?? {}) }
    });

    return json(200, result);
  } catch (error) {
    if (tokenInfo?.user_id) {
      await logAudit({
        userId: tokenInfo.user_id,
        tokenId: tokenInfo.id,
        action: String(body.action ?? "unknown"),
        clientName: body.client_name ?? "mcp-client",
        success: false,
        detail: { args_keys: Object.keys(body.args ?? {}) },
        errorMessage: error instanceof Error ? error.message : "Unknown error"
      });
    }

    return json(400, {
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});
