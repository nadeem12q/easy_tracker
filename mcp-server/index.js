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
    `/rest/v1/daily_entries?select=id,entry_date,mood_key,mood_label,day_rating,sleep_duration_minutes,sleep_duration_label,gratitude,review,best_moment,improved_today&entry_date=gte.${startDate}&entry_date=lte.${endDate}&order=entry_date.asc`
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
    improvement_mentions: 0
  };

  entries.forEach((entry) => {
    if (entry.gratitude?.trim()) buckets.gratitude_mentions += 1;
    if (entry.review?.trim()) buckets.review_mentions += 1;
    if (entry.best_moment?.trim()) buckets.best_moment_mentions += 1;
    if (entry.improved_today?.trim()) buckets.improvement_mentions += 1;
  });

  return buckets;
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
      const entry = await createOrGetDailyEntry(args.entry_date);
      const payload = [{ ...args.patch, id: entry.id, entry_date: args.entry_date }];
      const rows = await authFetch("/rest/v1/daily_entries", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(payload)
      });
      return rows[0];
    }

    case "set_sleep": {
      const entry = await createOrGetDailyEntry(args.entry_date);
      const rows = await authFetch("/rest/v1/daily_entries", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify([
          {
            id: entry.id,
            entry_date: args.entry_date,
            sleep_time: args.sleep_time,
            wake_time: args.wake_time
          }
        ])
      });
      return rows[0];
    }

    case "set_mood": {
      const entry = await createOrGetDailyEntry(args.entry_date);
      const rows = await authFetch("/rest/v1/daily_entries", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify([
          {
            id: entry.id,
            entry_date: args.entry_date,
            mood_key: args.mood_key ?? entry.mood_key,
            day_rating: args.day_rating ?? entry.day_rating
          }
        ])
      });
      return rows[0];
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
