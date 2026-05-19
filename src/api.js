import { DEFAULT_HABIT_SEED, MOOD_OPTIONS } from "./defaults.js";
import { calculateSleepDuration, createLocalId, normalizeRepeatDays, slugifyHabitName } from "./lib.js";
import { getSupabaseClient, hasSupabaseConfig } from "./supabase.js";

const LOCAL_STORAGE_KEY = "metrack-local-state-v1";

async function sha256Hex(value) {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

function createSecureToken() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

function getDefaultEntry(date) {
  return {
    entry_date: date,
    sleep_time: "",
    wake_time: "",
    sleep_duration_minutes: null,
    sleep_duration_label: "",
    sleep_quality: 0,
    sleep_quality_note: "",
    screen_time: "",
    mood_key: "",
    mood_label: "",
    mood_emoji: "",
    day_rating: 0,
    best_moment: "",
    improved_today: "",
    gratitude: "",
    review: "",
    goals_achieved: "",
    still_working_on: "",
    focus_for_tomorrow: "",
    intentions_for_tomorrow: ""
  };
}

function buildDefaultHabits() {
  return DEFAULT_HABIT_SEED.map((habit, index) => ({
    id: createLocalId("habit"),
    slug: habit.slug ?? slugifyHabitName(habit.name),
    name: habit.name,
    color: habit.color,
    category: habit.category,
    is_binary: true,
    position: habit.position ?? index,
    is_archived: false,
    reminder_enabled: false,
    reminder_time: "",
    reminder_message: "",
    reminder_snooze_minutes: 30,
    reminder_repeat_days: normalizeRepeatDays()
  }));
}

function getLocalState() {
  const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  if (raw) {
    return JSON.parse(raw);
  }

  const fresh = {
    habits: buildDefaultHabits(),
    entries: {},
    habitLogs: {},
    session: null
  };

  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

function setLocalState(nextState) {
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(nextState));
}

function getMoodPayload(moodKey) {
  return MOOD_OPTIONS.find((item) => item.key === moodKey) ?? {
    key: "",
    label: "",
    emoji: ""
  };
}

async function getRemoteSession() {
  if (!hasSupabaseConfig) {
    return null;
  }

  const supabase = await getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  return data.session;
}

function getOrCreateLocalEntry(date) {
  const state = getLocalState();
  if (!state.entries[date]) {
    state.entries[date] = getDefaultEntry(date);
    setLocalState(state);
  }

  return state.entries[date];
}

function getOrCreateLocalHabitLog(date, habits) {
  const state = getLocalState();

  if (!state.habitLogs[date]) {
    state.habitLogs[date] = Object.fromEntries(habits.map((habit) => [habit.id, false]));
    setLocalState(state);
  }

  return state.habitLogs[date];
}

export async function getSession() {
  if (!hasSupabaseConfig) {
    return getLocalState().session;
  }

  return getRemoteSession();
}

export async function signIn(email, password) {
  if (!hasSupabaseConfig) {
    const state = getLocalState();
    state.session = {
      user: {
        id: "local-user",
        email
      }
    };
    setLocalState(state);
    return state.session;
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw error;
  }

  return data.session;
}

export async function signUp(email, password) {
  if (!hasSupabaseConfig) {
    return signIn(email, password);
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    throw error;
  }

  return {
    session: data.session,
    user: data.user,
    needsEmailVerification: !data.session
  };
}

export async function subscribeToAuthChanges(onChange) {
  if (!hasSupabaseConfig) {
    return () => {};
  }

  const supabase = await getSupabaseClient();
  const {
    data: { subscription }
  } = supabase.auth.onAuthStateChange((_event, session) => {
    onChange(session);
  });

  return () => subscription.unsubscribe();
}

export async function signOut() {
  if (!hasSupabaseConfig) {
    const state = getLocalState();
    state.session = null;
    setLocalState(state);
    return;
  }

  const supabase = await getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }

  window.localStorage.removeItem(LOCAL_STORAGE_KEY);
}

export async function ensureDefaultHabits() {
  if (!hasSupabaseConfig || !(await getRemoteSession())) {
    const state = getLocalState();
    if (!state.habits?.length) {
      state.habits = buildDefaultHabits();
      setLocalState(state);
    }
    return state.habits;
  }

  const supabase = await getSupabaseClient();
  const { data: existing, error: existingError } = await supabase
    .from("user_habits")
    .select("*")
    .eq("is_archived", false)
    .order("position", { ascending: true });

  if (existingError) {
    throw existingError;
  }

  if (existing.length) {
    return existing;
  }

  const { data, error } = await supabase
    .from("user_habits")
    .insert(
      DEFAULT_HABIT_SEED.map((habit, index) => ({
        name: habit.name,
        slug: habit.slug,
        color: habit.color,
        category: habit.category,
        position: habit.position ?? index,
        is_binary: true
      }))
    )
    .select("*");

  if (error) {
    throw error;
  }

  return data;
}

export async function listHabits() {
  if (!hasSupabaseConfig || !(await getRemoteSession())) {
    return getLocalState().habits ?? buildDefaultHabits();
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("user_habits")
    .select("*")
    .eq("is_archived", false)
    .order("position", { ascending: true });

  if (error) {
    throw error;
  }

  return data;
}

export async function createHabit(name) {
  const slug = slugifyHabitName(name);

  if (!hasSupabaseConfig || !(await getRemoteSession())) {
    const state = getLocalState();
    const habit = {
      id: createLocalId("habit"),
      slug,
      name,
      color: "var(--mint)",
      category: "custom",
      is_binary: true,
      position: state.habits.length,
      is_archived: false,
      reminder_enabled: false,
      reminder_time: "",
      reminder_message: "",
      reminder_snooze_minutes: 30,
      reminder_repeat_days: normalizeRepeatDays()
    };
    state.habits.push(habit);
    setLocalState(state);
    return habit;
  }

  const supabase = await getSupabaseClient();
  const habits = await listHabits();
  const { data, error } = await supabase
    .from("user_habits")
    .insert({
      name,
      slug,
      color: "var(--mint)",
      category: "custom",
      is_binary: true,
      position: habits.length,
      reminder_enabled: false,
      reminder_time: null,
      reminder_message: "",
      reminder_snooze_minutes: 30,
      reminder_repeat_days: normalizeRepeatDays()
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function archiveHabit(habitId) {
  if (!hasSupabaseConfig || !(await getRemoteSession())) {
    const state = getLocalState();
    state.habits = state.habits.filter((habit) => habit.id !== habitId);
    Object.keys(state.habitLogs).forEach((date) => {
      delete state.habitLogs[date][habitId];
    });
    setLocalState(state);
    return;
  }

  const supabase = await getSupabaseClient();
  const { error } = await supabase
    .from("user_habits")
    .update({ is_archived: true, archived_at: new Date().toISOString() })
    .eq("id", habitId);

  if (error) {
    throw error;
  }
}

async function upsertEntry(entry) {
  const duration = calculateSleepDuration(entry.sleep_time, entry.wake_time);
  const payload = {
    ...entry,
    sleep_duration_minutes: duration.minutes,
    sleep_duration_label: duration.label
  };

  if (!hasSupabaseConfig || !(await getRemoteSession())) {
    const state = getLocalState();
    state.entries[entry.entry_date] = payload;
    setLocalState(state);
    return payload;
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("daily_entries")
    .upsert(payload, { onConflict: "user_id,entry_date" })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function getDailyState(date) {
  const habits = await ensureDefaultHabits();

  if (!hasSupabaseConfig || !(await getRemoteSession())) {
    const entry = getOrCreateLocalEntry(date);
    const habitLog = getOrCreateLocalHabitLog(date, habits);
    return { entry, habits, habitLog };
  }

  const supabase = await getSupabaseClient();
  const { data: entryRows, error: entryError } = await supabase
    .from("daily_entries")
    .select("*")
    .eq("entry_date", date)
    .limit(1);

  if (entryError) {
    throw entryError;
  }

  let entry = entryRows[0];

  if (!entry) {
    entry = await upsertEntry(getDefaultEntry(date));
  }

  const { data: logs, error: logsError } = await supabase
    .from("daily_habit_logs")
    .select("habit_id, done")
    .eq("entry_id", entry.id);

  if (logsError) {
    throw logsError;
  }

  const habitLog = Object.fromEntries(habits.map((habit) => [habit.id, false]));
  logs.forEach((row) => {
    habitLog[row.habit_id] = row.done;
  });

  return { entry, habits, habitLog };
}

export async function saveEntryFields(date, patch) {
  const current = hasSupabaseConfig && (await getRemoteSession())
    ? (await getDailyState(date)).entry
    : getOrCreateLocalEntry(date);
  const next = { ...current, ...patch, entry_date: date };

  if (patch.mood_key) {
    const mood = getMoodPayload(patch.mood_key);
    next.mood_key = mood.key;
    next.mood_label = mood.label;
    next.mood_emoji = mood.emoji;
  }

  return upsertEntry(next);
}

export async function toggleHabit(date, habitId) {
  const state = await getDailyState(date);
  const nextValue = !state.habitLog[habitId];

  if (!hasSupabaseConfig || !(await getRemoteSession())) {
    const local = getLocalState();
    local.habitLogs[date][habitId] = nextValue;
    setLocalState(local);
    return nextValue;
  }

  const supabase = await getSupabaseClient();
  const { error } = await supabase.from("daily_habit_logs").upsert(
    {
      entry_id: state.entry.id,
      habit_id: habitId,
      done: nextValue
    },
    { onConflict: "entry_id,habit_id" }
  );

  if (error) {
    throw error;
  }

  return nextValue;
}

export async function listMcpTokens() {
  if (!hasSupabaseConfig || !(await getRemoteSession())) {
    return [];
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("mcp_api_tokens")
    .select("id,label,token_prefix,can_write,can_analyze,expires_at,last_used_at,revoked_at,created_at")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data;
}

export async function createMcpToken({
  label,
  canWrite = true,
  canAnalyze = true,
  expiresAt
}) {
  if (!hasSupabaseConfig || !(await getRemoteSession())) {
    throw new Error("MCP token create karne ke liye signed-in account zaroori hai.");
  }

  const rawToken = createSecureToken();
  const tokenHash = await sha256Hex(rawToken);
  const tokenPrefix = rawToken.slice(0, 8);

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("mcp_api_tokens")
    .insert({
      label,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      can_write: canWrite,
      can_analyze: canAnalyze,
      ...(expiresAt ? { expires_at: expiresAt } : {})
    })
    .select("id,label,token_prefix,can_write,can_analyze,expires_at,last_used_at,revoked_at,created_at")
    .single();

  if (error) {
    throw error;
  }

  return {
    token: `mtk_${rawToken}`,
    record: data
  };
}

export async function revokeMcpToken(tokenId) {
  if (!hasSupabaseConfig || !(await getRemoteSession())) {
    throw new Error("MCP token revoke karne ke liye signed-in account zaroori hai.");
  }

  const supabase = await getSupabaseClient();
  const { error } = await supabase
    .from("mcp_api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId);

  if (error) {
    throw error;
  }
}

export async function updateHabitReminder(habitId, patch) {
  const normalized = {
    reminder_enabled: Boolean(patch.reminder_enabled),
    reminder_time: patch.reminder_enabled ? patch.reminder_time || null : null,
    reminder_message: patch.reminder_message ?? "",
    reminder_snooze_minutes: Number(patch.reminder_snooze_minutes ?? 30),
    ...(patch.reminder_repeat_days
      ? { reminder_repeat_days: normalizeRepeatDays(patch.reminder_repeat_days) }
      : {})
  };

  if (!hasSupabaseConfig || !(await getRemoteSession())) {
    const state = getLocalState();
    state.habits = state.habits.map((habit) =>
      habit.id === habitId
        ? {
            ...habit,
            ...normalized,
            reminder_time: normalized.reminder_time ?? "",
            reminder_message: normalized.reminder_message
          }
        : habit
    );
    setLocalState(state);
    return state.habits.find((habit) => habit.id === habitId) ?? null;
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("user_habits")
    .update(normalized)
    .eq("id", habitId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function setHabitStatus(date, habitId, done) {
  const state = await getDailyState(date);

  if (!hasSupabaseConfig || !(await getRemoteSession())) {
    const local = getLocalState();
    if (!local.habitLogs[date]) {
      local.habitLogs[date] = {};
    }
    local.habitLogs[date][habitId] = Boolean(done);
    setLocalState(local);
    return Boolean(done);
  }

  const supabase = await getSupabaseClient();
  const { error } = await supabase.from("daily_habit_logs").upsert(
    {
      entry_id: state.entry.id,
      habit_id: habitId,
      done: Boolean(done)
    },
    { onConflict: "entry_id,habit_id" }
  );

  if (error) {
    throw error;
  }

  return Boolean(done);
}
