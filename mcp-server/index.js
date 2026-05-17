import { createInterface } from "node:readline";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const DEFAULT_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  "Content-Type": "application/json"
};

let authSession = null;

function startOfDay(dateText) {
  return new Date(`${dateText}T00:00:00Z`);
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(dateText, offsetDays) {
  const date = startOfDay(dateText);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return formatDate(date);
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function ok(id, result) {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function fail(id, message) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: { code: -32000, message }
  });
}

async function authFetch(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL aur SUPABASE_ANON_KEY required hain.");
  }

  const headers = {
    ...DEFAULT_HEADERS,
    ...(options.headers || {})
  };

  if (authSession?.access_token) {
    headers.Authorization = `Bearer ${authSession.access_token}`;
  }

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || `Supabase error ${response.status}`);
  }

  return payload;
}

function requireSession() {
  if (!authSession?.access_token || !authSession?.user) {
    throw new Error("Pehle `sign_in` tool se login karein.");
  }
}

async function signIn(argumentsObject) {
  const payload = await authFetch("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({
      email: argumentsObject.email,
      password: argumentsObject.password
    })
  });

  authSession = payload;
  return {
    email: payload.user?.email,
    user_id: payload.user?.id,
    expires_in: payload.expires_in
  };
}

async function signOut() {
  requireSession();

  await authFetch("/auth/v1/logout", {
    method: "POST"
  });

  authSession = null;
  return { success: true };
}

function whoAmI() {
  requireSession();
  return {
    user_id: authSession.user.id,
    email: authSession.user.email
  };
}

async function getHabits() {
  requireSession();
  return authFetch("/rest/v1/user_habits?select=id,name,slug,category,color,position,is_archived&is_archived=eq.false&order=position.asc");
}

async function getEntriesBetween(startDate, endDate) {
  requireSession();
  return authFetch(
    `/rest/v1/daily_entries?select=id,entry_date,mood_key,mood_label,day_rating,sleep_time,wake_time,sleep_quality,screen_time,sleep_duration_minutes,sleep_duration_label,gratitude,review,best_moment,improved_today,goals_achieved,still_working_on,focus_for_tomorrow,intentions_for_tomorrow&entry_date=gte.${startDate}&entry_date=lte.${endDate}&order=entry_date.asc`
  );
}

async function getLogsForEntryIds(entryIds) {
  requireSession();
  if (!entryIds.length) {
    return [];
  }

  const filter = `(${entryIds.join(",")})`;
  return authFetch(
    `/rest/v1/daily_habit_logs?select=entry_id,habit_id,done&entry_id=in.${filter}`
  );
}

function summarizeReflectionText(entries) {
  const buckets = {
    gratitude_mentions: 0,
    review_mentions: 0,
    best_moment_mentions: 0,
    improvement_mentions: 0,
    goals_mentions: 0,
    tomorrow_focus_mentions: 0
  };

  entries.forEach((entry) => {
    if (entry.gratitude?.trim()) buckets.gratitude_mentions += 1;
    if (entry.review?.trim()) buckets.review_mentions += 1;
    if (entry.best_moment?.trim()) buckets.best_moment_mentions += 1;
    if (entry.improved_today?.trim()) buckets.improvement_mentions += 1;
    if (entry.goals_achieved?.trim() || entry.still_working_on?.trim()) buckets.goals_mentions += 1;
    if (entry.focus_for_tomorrow?.trim() || entry.intentions_for_tomorrow?.trim()) {
      buckets.tomorrow_focus_mentions += 1;
    }
  });

  return buckets;
}

function average(numbers) {
  if (!numbers.length) return 0;
  return numbers.reduce((sum, item) => sum + item, 0) / numbers.length;
}

function buildHabitConsistency(habits, entries, logs, requestedDays) {
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
    let previousDate = null;

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

function buildMissedHabitsReport(habits, logs, entryId) {
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

function buildTopStrugglesReport(consistencyRows, limit = 5) {
  return [...consistencyRows]
    .sort((a, b) => {
      if (a.completion_rate !== b.completion_rate) {
        return a.completion_rate - b.completion_rate;
      }
      return a.current_streak - b.current_streak;
    })
    .slice(0, limit);
}

function completionRateForEntry(entry, logs, habits) {
  if (!entry || !habits.length) return 0;
  const doneCount = logs.filter((log) => log.entry_id === entry.id && log.done).length;
  return Number(((doneCount / habits.length) * 100).toFixed(1));
}

function buildMissingFieldList(entry) {
  const missing = [];

  if (!entry?.sleep_time) missing.push("sleep_time");
  if (!entry?.wake_time) missing.push("wake_time");
  if (!entry?.sleep_quality) missing.push("sleep_quality");
  if (!entry?.screen_time?.trim?.()) missing.push("screen_time");
  if (!entry?.mood_key) missing.push("mood");
  if (!entry?.day_rating) missing.push("day_rating");
  if (!entry?.gratitude?.trim?.()) missing.push("gratitude");
  if (!entry?.review?.trim?.()) missing.push("review");
  if (!entry?.focus_for_tomorrow?.trim?.() && !entry?.intentions_for_tomorrow?.trim?.()) {
    missing.push("tomorrow_focus");
  }

  return missing;
}

function buildDailyGapAnalysis(entry, habits, logs) {
  const completionRate = completionRateForEntry(entry, logs, habits);
  const missedHabits = buildMissedHabitsReport(habits, logs, entry.id);
  const missingFields = buildMissingFieldList(entry);

  let status = "strong";
  if (completionRate < 40 || missingFields.length >= 5) {
    status = "needs_attention";
  } else if (completionRate < 70 || missingFields.length >= 2) {
    status = "in_progress";
  }

  return {
    entry_date: entry.entry_date,
    completion_rate: completionRate,
    done_habits: habits.length - missedHabits.length,
    total_habits: habits.length,
    missed_habits: missedHabits,
    missing_fields: missingFields,
    sleep_logged: Boolean(entry.sleep_time && entry.wake_time),
    reflection_logged: Boolean(
      entry.gratitude?.trim?.() || entry.review?.trim?.() || entry.best_moment?.trim?.()
    ),
    status
  };
}

function buildRecommendedFocus(consistencyRows, reflectionSummary, latestEntry) {
  const weakHabits = buildTopStrugglesReport(consistencyRows, 3);
  const suggestions = [];

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

function buildStreakRiskReport(consistencyRows) {
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
      const weight = { high: 0, medium: 1, low: 2 };
      if (weight[a.risk_level] !== weight[b.risk_level]) {
        return weight[a.risk_level] - weight[b.risk_level];
      }
      return a.completion_rate - b.completion_rate;
    });
}

function buildMomentumReport(currentEntries, previousEntries, currentLogs, previousLogs, habits) {
  const currentDone = currentLogs.filter((log) => log.done).length;
  const previousDone = previousLogs.filter((log) => log.done).length;
  const currentHabitSlots = currentEntries.length * Math.max(habits.length, 1);
  const previousHabitSlots = previousEntries.length * Math.max(habits.length, 1);

  const currentCompletion = currentHabitSlots
    ? Number(((currentDone / currentHabitSlots) * 100).toFixed(1))
    : 0;
  const previousCompletion = previousHabitSlots
    ? Number(((previousDone / previousHabitSlots) * 100).toFixed(1))
    : 0;

  const currentRatings = currentEntries.map((entry) => entry.day_rating).filter(Boolean);
  const previousRatings = previousEntries.map((entry) => entry.day_rating).filter(Boolean);
  const currentSleep = currentEntries
    .map((entry) => entry.sleep_duration_minutes)
    .filter((value) => Number.isFinite(value));
  const previousSleep = previousEntries
    .map((entry) => entry.sleep_duration_minutes)
    .filter((value) => Number.isFinite(value));

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

function buildCoachingBrief(consistencyRows, reflectionSummary, entries, momentumReport) {
  const latestEntry = entries[entries.length - 1] ?? null;
  const strongest = [...consistencyRows]
    .sort((a, b) => b.completion_rate - a.completion_rate)
    .slice(0, 3);
  const weakest = buildTopStrugglesReport(consistencyRows, 3);
  const focus = buildRecommendedFocus(consistencyRows, reflectionSummary, latestEntry);

  const moodCounts = {};
  entries.forEach((entry) => {
    if (entry.mood_key) {
      moodCounts[entry.mood_key] = (moodCounts[entry.mood_key] ?? 0) + 1;
    }
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

async function getDailyEntry(entryDate) {
  requireSession();
  const rows = await authFetch(
    `/rest/v1/daily_entries?select=*&entry_date=eq.${entryDate}&limit=1`
  );
  return rows[0] ?? null;
}

async function createOrGetDailyEntry(entryDate) {
  let entry = await getDailyEntry(entryDate);
  if (entry) return entry;

  const payload = await authFetch("/rest/v1/daily_entries", {
    method: "POST",
    headers: { Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify([{ entry_date: entryDate }])
  });

  return payload[0];
}

async function upsertDailyEntry(entryDate, patch) {
  const entry = await createOrGetDailyEntry(entryDate);
  const payload = await authFetch("/rest/v1/daily_entries", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{ ...patch, id: entry.id, entry_date: entryDate }])
  });

  return payload[0];
}

async function resolveHabitsByNames(habitNames = []) {
  const habits = await getHabits();
  const normalized = habitNames.map((item) => item.toLowerCase().trim());
  const matched = habits.filter((habit) => normalized.includes(habit.name.toLowerCase()));
  const matchedNames = new Set(matched.map((habit) => habit.name.toLowerCase()));
  const unmatched = habitNames.filter((name) => !matchedNames.has(name.toLowerCase().trim()));
  return { habits, matched, unmatched };
}

async function listTools() {
  return {
    tools: [
      {
        name: "sign_in",
        description: "Email/password se MeTrack account login karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            email: { type: "string" },
            password: { type: "string" }
          },
          required: ["email", "password"]
        }
      },
      {
        name: "get_today_dashboard",
        description: "Aaj ya kisi date ka tracker state read karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            entry_date: { type: "string", description: "YYYY-MM-DD" }
          },
          required: ["entry_date"]
        }
      },
      {
        name: "sign_out",
        description: "Current authenticated session ko close karta hai.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "who_am_i",
        description: "Current logged-in user ki basic identity return karta hai.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "mark_habits",
        description: "Habits ko done ya undone mark karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            entry_date: { type: "string" },
            habit_names: { type: "array", items: { type: "string" } },
            done: { type: "boolean" }
          },
          required: ["entry_date", "habit_names", "done"]
        }
      },
      {
        name: "update_reflection",
        description: "Reflection fields, gratitude aur notes save karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            entry_date: { type: "string" },
            patch: { type: "object" }
          },
          required: ["entry_date", "patch"]
        }
      },
      {
        name: "set_sleep",
        description: "Sleep aur wake-up times set karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            entry_date: { type: "string" },
            sleep_time: { type: "string" },
            wake_time: { type: "string" }
          },
          required: ["entry_date", "sleep_time", "wake_time"]
        }
      },
      {
        name: "set_mood",
        description: "Mood aur day rating update karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            entry_date: { type: "string" },
            mood_key: { type: "string" },
            day_rating: { type: "integer" }
          },
          required: ["entry_date"]
        }
      },
      {
        name: "weekly_summary",
        description: "Recent 7 din ka summary aur completion snapshot deta hai.",
        inputSchema: {
          type: "object",
          properties: {
            end_date: { type: "string" }
          },
          required: ["end_date"]
        }
      },
      {
        name: "habit_consistency_report",
        description: "Habits ki consistency, streaks aur completion rate report deta hai.",
        inputSchema: {
          type: "object",
          properties: {
            end_date: { type: "string" },
            days: { type: "integer" }
          },
          required: ["end_date"]
        }
      },
      {
        name: "reflection_pattern_report",
        description: "Mood, reflection usage aur sleep pattern ka readable report deta hai.",
        inputSchema: {
          type: "object",
          properties: {
            end_date: { type: "string" },
            days: { type: "integer" }
          },
          required: ["end_date"]
        }
      },
      {
        name: "missed_habits_report",
        description: "Kisi specific din ki woh habits batata hai jo abhi done nahin hui.",
        inputSchema: {
          type: "object",
          properties: {
            entry_date: { type: "string" }
          },
          required: ["entry_date"]
        }
      },
      {
        name: "top_struggles_report",
        description: "Recent days mein sab se weak habits identify karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            end_date: { type: "string" },
            days: { type: "integer" },
            limit: { type: "integer" }
          },
          required: ["end_date"]
        }
      },
      {
        name: "recommended_focus_for_tomorrow",
        description: "Recent pattern dekh kar kal ke liye short focus recommendations deta hai.",
        inputSchema: {
          type: "object",
          properties: {
            end_date: { type: "string" },
            days: { type: "integer" }
          },
          required: ["end_date"]
        }
      },
      {
        name: "capture_day_update",
        description: "Agent ke liye aik hi call mein habits, sleep, mood aur reflection fields update karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            entry_date: { type: "string" },
            done_habits: { type: "array", items: { type: "string" } },
            undone_habits: { type: "array", items: { type: "string" } },
            sleep_time: { type: "string" },
            wake_time: { type: "string" },
            mood_key: { type: "string" },
            day_rating: { type: "integer" },
            screen_time: { type: "string" },
            patch: { type: "object" }
          },
          required: ["entry_date"]
        }
      },
      {
        name: "daily_gap_analysis",
        description: "Kisi specific din ka completion gap, missing fields aur missed habits analyze karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            entry_date: { type: "string" }
          },
          required: ["entry_date"]
        }
      },
      {
        name: "streak_risk_report",
        description: "Recent days dekh kar batata hai ke kaun si habits streak lose karne ke risk par hain.",
        inputSchema: {
          type: "object",
          properties: {
            end_date: { type: "string" },
            days: { type: "integer" }
          },
          required: ["end_date"]
        }
      },
      {
        name: "momentum_report",
        description: "Current aur previous window compare karke progress ya decline show karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            end_date: { type: "string" },
            window_days: { type: "integer" }
          },
          required: ["end_date"]
        }
      },
      {
        name: "coaching_brief",
        description: "Habits, reflections aur recent trend ko combine karke short coaching brief deta hai.",
        inputSchema: {
          type: "object",
          properties: {
            end_date: { type: "string" },
            days: { type: "integer" }
          },
          required: ["end_date"]
        }
      }
    ]
  };
}

async function callTool(name, args) {
  switch (name) {
    case "sign_in":
      return signIn(args);

    case "sign_out":
      return signOut();

    case "who_am_i":
      return whoAmI();

    case "get_today_dashboard": {
      const entry = await createOrGetDailyEntry(args.entry_date);
      const habits = await getHabits();
      const logs = await authFetch(
        `/rest/v1/daily_habit_logs?select=habit_id,done&entry_id=eq.${entry.id}`
      );
      return { entry, habits, logs };
    }

    case "mark_habits": {
      const entry = await createOrGetDailyEntry(args.entry_date);
      const habits = await getHabits();
      const picked = habits.filter((habit) =>
        args.habit_names.some((name) => name.toLowerCase() === habit.name.toLowerCase())
      );

      if (!picked.length) {
        throw new Error("Koi matching habit nahin mili.");
      }

      const rows = picked.map((habit) => ({
        entry_id: entry.id,
        habit_id: habit.id,
        done: args.done
      }));

      await authFetch("/rest/v1/daily_habit_logs", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(rows)
      });

      return {
        entry_date: args.entry_date,
        updated_habits: picked.map((habit) => habit.name),
        done: args.done
      };
    }

    case "update_reflection": {
      return upsertDailyEntry(args.entry_date, args.patch);
    }

    case "set_sleep": {
      return upsertDailyEntry(args.entry_date, {
        sleep_time: args.sleep_time,
        wake_time: args.wake_time
      });
    }

    case "set_mood": {
      const entry = await createOrGetDailyEntry(args.entry_date);
      return upsertDailyEntry(args.entry_date, {
        mood_key: args.mood_key ?? entry.mood_key,
        day_rating: args.day_rating ?? entry.day_rating
      });
    }

    case "weekly_summary": {
      requireSession();
      const rows = await authFetch(
        `/rest/v1/daily_entries?select=entry_date,mood_key,day_rating,sleep_duration_label&order=entry_date.desc&entry_date=lte.${args.end_date}&limit=7`
      );
      return { entries: rows };
    }

    case "habit_consistency_report": {
      requireSession();
      const days = Math.max(1, Math.min(args.days ?? 14, 90));
      const startDate = shiftDate(args.end_date, -(days - 1));
      const [habits, entries] = await Promise.all([
        getHabits(),
        getEntriesBetween(startDate, args.end_date)
      ]);
      const logs = await getLogsForEntryIds(entries.map((entry) => entry.id));
      return {
        start_date: startDate,
        end_date: args.end_date,
        days,
        habits: buildHabitConsistency(habits, entries, logs, days)
      };
    }

    case "reflection_pattern_report": {
      requireSession();
      const days = Math.max(1, Math.min(args.days ?? 14, 90));
      const startDate = shiftDate(args.end_date, -(days - 1));
      const entries = await getEntriesBetween(startDate, args.end_date);
      const moodCounts = {};
      let ratedDays = 0;
      let totalRating = 0;
      let sleepTrackedDays = 0;
      let totalSleepMinutes = 0;

      entries.forEach((entry) => {
        if (entry.mood_key) {
          moodCounts[entry.mood_key] = (moodCounts[entry.mood_key] ?? 0) + 1;
        }
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
        average_sleep_minutes: sleepTrackedDays
          ? Math.round(totalSleepMinutes / sleepTrackedDays)
          : 0,
        reflection_activity: summarizeReflectionText(entries)
      };
    }

    case "missed_habits_report": {
      requireSession();
      const [entry, habits] = await Promise.all([
        createOrGetDailyEntry(args.entry_date),
        getHabits()
      ]);
      const logs = await authFetch(
        `/rest/v1/daily_habit_logs?select=entry_id,habit_id,done&entry_id=eq.${entry.id}`
      );
      return {
        entry_date: args.entry_date,
        missed_habits: buildMissedHabitsReport(habits, logs, entry.id)
      };
    }

    case "top_struggles_report": {
      requireSession();
      const days = Math.max(1, Math.min(args.days ?? 14, 90));
      const startDate = shiftDate(args.end_date, -(days - 1));
      const [habits, entries] = await Promise.all([
        getHabits(),
        getEntriesBetween(startDate, args.end_date)
      ]);
      const logs = await getLogsForEntryIds(entries.map((entry) => entry.id));
      const consistencyRows = buildHabitConsistency(habits, entries, logs, days);
      return {
        start_date: startDate,
        end_date: args.end_date,
        days,
        struggles: buildTopStrugglesReport(consistencyRows, args.limit ?? 5)
      };
    }

    case "recommended_focus_for_tomorrow": {
      requireSession();
      const days = Math.max(1, Math.min(args.days ?? 14, 90));
      const startDate = shiftDate(args.end_date, -(days - 1));
      const [habits, entries] = await Promise.all([
        getHabits(),
        getEntriesBetween(startDate, args.end_date)
      ]);
      const logs = await getLogsForEntryIds(entries.map((entry) => entry.id));
      const consistencyRows = buildHabitConsistency(habits, entries, logs, days);
      const reflectionSummary = summarizeReflectionText(entries);
      const latestEntry = entries[entries.length - 1] ?? null;

      return {
        start_date: startDate,
        end_date: args.end_date,
        days,
        ...buildRecommendedFocus(consistencyRows, reflectionSummary, latestEntry)
      };
    }

    case "capture_day_update": {
      requireSession();
      const entry = await createOrGetDailyEntry(args.entry_date);
      const habits = await getHabits();
      const byName = new Map(habits.map((habit) => [habit.name.toLowerCase(), habit]));
      const doneNames = args.done_habits ?? [];
      const undoneNames = args.undone_habits ?? [];
      const doneHabits = doneNames
        .map((name) => byName.get(name.toLowerCase().trim()))
        .filter(Boolean);
      const undoneHabits = undoneNames
        .map((name) => byName.get(name.toLowerCase().trim()))
        .filter(Boolean);
      const unmatchedDone = doneNames.filter((name) => !byName.has(name.toLowerCase().trim()));
      const unmatchedUndone = undoneNames.filter((name) => !byName.has(name.toLowerCase().trim()));

      const logRows = [
        ...doneHabits.map((habit) => ({ entry_id: entry.id, habit_id: habit.id, done: true })),
        ...undoneHabits.map((habit) => ({ entry_id: entry.id, habit_id: habit.id, done: false }))
      ];

      if (logRows.length) {
        await authFetch("/rest/v1/daily_habit_logs", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify(logRows)
        });
      }

      const updatedEntry = await upsertDailyEntry(args.entry_date, {
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
        done_habits: doneHabits.map((habit) => habit.name),
        undone_habits: undoneHabits.map((habit) => habit.name),
        unmatched_habit_names: [...unmatchedDone, ...unmatchedUndone],
        entry_fields_updated: Object.keys({
          ...(args.patch ?? {}),
          ...(args.sleep_time ? { sleep_time: true } : {}),
          ...(args.wake_time ? { wake_time: true } : {}),
          ...(args.mood_key ? { mood_key: true } : {}),
          ...(Number.isInteger(args.day_rating) ? { day_rating: true } : {}),
          ...(args.screen_time ? { screen_time: true } : {})
        })
      };
    }

    case "daily_gap_analysis": {
      requireSession();
      const [entry, habits] = await Promise.all([
        createOrGetDailyEntry(args.entry_date),
        getHabits()
      ]);
      const logs = await authFetch(
        `/rest/v1/daily_habit_logs?select=entry_id,habit_id,done&entry_id=eq.${entry.id}`
      );
      return buildDailyGapAnalysis(entry, habits, logs);
    }

    case "streak_risk_report": {
      requireSession();
      const days = Math.max(3, Math.min(args.days ?? 14, 90));
      const startDate = shiftDate(args.end_date, -(days - 1));
      const [habits, entries] = await Promise.all([
        getHabits(),
        getEntriesBetween(startDate, args.end_date)
      ]);
      const logs = await getLogsForEntryIds(entries.map((entry) => entry.id));
      const consistencyRows = buildHabitConsistency(habits, entries, logs, days);

      return {
        start_date: startDate,
        end_date: args.end_date,
        days,
        risks: buildStreakRiskReport(consistencyRows)
      };
    }

    case "momentum_report": {
      requireSession();
      const windowDays = Math.max(3, Math.min(args.window_days ?? 7, 30));
      const currentStartDate = shiftDate(args.end_date, -(windowDays - 1));
      const previousEndDate = shiftDate(currentStartDate, -1);
      const previousStartDate = shiftDate(previousEndDate, -(windowDays - 1));

      const habits = await getHabits();
      const [currentEntries, previousEntries] = await Promise.all([
        getEntriesBetween(currentStartDate, args.end_date),
        getEntriesBetween(previousStartDate, previousEndDate)
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
      requireSession();
      const days = Math.max(3, Math.min(args.days ?? 14, 90));
      const startDate = shiftDate(args.end_date, -(days - 1));
      const previousEndDate = shiftDate(startDate, -1);
      const previousStartDate = shiftDate(previousEndDate, -(days - 1));
      const [habits, entries, previousEntries] = await Promise.all([
        getHabits(),
        getEntriesBetween(startDate, args.end_date),
        getEntriesBetween(previousStartDate, previousEndDate)
      ]);
      const [logs, previousLogs] = await Promise.all([
        getLogsForEntryIds(entries.map((entry) => entry.id)),
        getLogsForEntryIds(previousEntries.map((entry) => entry.id))
      ]);
      const consistencyRows = buildHabitConsistency(habits, entries, logs, days);
      const reflectionSummary = summarizeReflectionText(entries);
      const momentum = buildMomentumReport(
        entries,
        previousEntries,
        logs,
        previousLogs,
        habits
      );

      return {
        start_date: startDate,
        end_date: args.end_date,
        days,
        ...buildCoachingBrief(consistencyRows, reflectionSummary, entries, momentum)
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const lineReader = createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

lineReader.on("line", async (line) => {
  if (!line.trim()) return;

  try {
    const message = JSON.parse(line);

    if (message.method === "initialize") {
      ok(message.id, {
        protocolVersion: "2024-11-05",
        serverInfo: {
          name: "metrack-mcp",
          version: "0.1.0"
        },
        capabilities: {
          tools: {}
        }
      });
      return;
    }

    if (message.method === "tools/list") {
      ok(message.id, await listTools());
      return;
    }

    if (message.method === "tools/call") {
      const output = await callTool(message.params.name, message.params.arguments || {});
      ok(message.id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(output, null, 2)
          }
        ]
      });
      return;
    }

    fail(message.id, `Unsupported method: ${message.method}`);
  } catch (error) {
    fail(null, error.message);
  }
});
