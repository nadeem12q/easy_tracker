import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlarmClock,
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  Circle,
  Heart,
  Home,
  Lock,
  LogOut,
  Moon,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  User,
  X
} from "lucide-react";
import {
  archiveHabit,
  createHabit,
  ensureDefaultHabits,
  getDailyState,
  getSession,
  saveEntryFields,
  setHabitStatus,
  signIn,
  signOut,
  signUp,
  subscribeToAuthChanges,
  toggleHabit,
  updateHabitReminder
} from "./api.js";
import { DAY_RATING_STARS, MOOD_OPTIONS, QUALITY_STARS, WEEKDAY_LABELS } from "./defaults.js";
import { calculateSleepDuration, formatDateInput, normalizeRepeatDays, weekdayFromDate } from "./lib.js";
import {
  clearHabitReminderNotifications,
  describeReminder,
  ensureReminderPermissions,
  registerReminderActionListener,
  registerReminderAppStateListener,
  reminderActionIds,
  scheduleLaterReminder,
  syncHabitReminderNotifications
} from "./notifications.js";
import ReminderCenter from "./ReminderCenter.jsx";
import SecurityPanel from "./SecurityPanel.jsx";
import { hasSupabaseConfig } from "./supabase.js";

const APP_SETTINGS_KEY = "metrack-app-settings-v1";

const DEFAULT_APP_SETTINGS = {
  languageMode: "mixed",
  todayFocus: "habits"
};

const HELP_TEXT = {
  mixed: {
    preview:
      "Preview mode mein app dekh sakte hain. Permanent sync ke liye account create ya login karein.",
    account:
      "Aap ka data account ke saath sync ho raha hai. More screen mein reminders aur security settings milengi.",
    authIntro:
      "Account se tracker save hota hai aur Android app mein reminders zyada reliable ho jate hain.",
    noSecurity: "Security tools ke liye signed-in account zaroori hai.",
    noReminderTime: "Reminder enable karne ke liye time zaroori hai.",
    permission: "Notification permission allow karein, phir reminder enable hoga.",
    loginSuccess: "Login ho gaya.",
    signupSuccess: "Account create ho gaya.",
    signupVerify: "Account create ho gaya. Email verify karke phir login karein.",
    reminderSaved: "Reminder save ho gaya.",
    reminderExact:
      "Reminder save ho gaya. Android exact alarm setting bhi allow kar dein aur app dobara khol kar check karein.",
    habitDone: "done mark ho gayi.",
    habitNotDone: "abhi not done par set ho gayi.",
    snoozed: "minutes baad dobara aayega.",
    settingsSaved: "Settings save ho gayi."
  },
  english: {
    preview: "Preview mode lets you explore the app. Create or sign in to sync permanently.",
    account: "Your tracker is syncing with your account. Reminders and security live in More.",
    authIntro: "An account saves your tracker and makes Android reminders more reliable.",
    noSecurity: "Sign in to use security tools.",
    noReminderTime: "Choose a time before enabling this reminder.",
    permission: "Allow notification permission before enabling reminders.",
    loginSuccess: "You are signed in.",
    signupSuccess: "Account created.",
    signupVerify: "Account created. Verify your email, then sign in.",
    reminderSaved: "Reminder saved.",
    reminderExact:
      "Reminder saved. Also allow Android exact alarm access, then reopen the app to confirm.",
    habitDone: "marked done.",
    habitNotDone: "marked not done.",
    snoozed: "will remind you again in a few minutes.",
    settingsSaved: "Settings saved."
  }
};

const MOOD_ICONS = {
  happy: Sparkles,
  confident: ShieldCheck,
  calm: Heart,
  angry: Activity,
  sad: Moon,
  insecure: Circle
};

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

function loadAppSettings() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(APP_SETTINGS_KEY) ?? "{}");
    return { ...DEFAULT_APP_SETTINGS, ...saved };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

function formatDateLabel(dateText) {
  return new Date(`${dateText}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function Field({ label, children, className }) {
  return (
    <label className={cx("field", className)}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function IconButton({ label, icon: Icon, className, ...props }) {
  return (
    <button type="button" className={cx("icon-button", className)} aria-label={label} title={label} {...props}>
      <Icon size={20} aria-hidden="true" />
    </button>
  );
}

function SectionHeader({ eyebrow, title, action }) {
  return (
    <div className="section-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function SegmentedControl({ value, options, onChange }) {
  return (
    <div className="segmented-control">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cx(value === option.value && "active")}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function StarSelector({ value, onPick }) {
  return (
    <div className="rating-row">
      {QUALITY_STARS.map((star) => (
        <button
          key={star}
          type="button"
          className={cx("rating-button", value === star && "active")}
          onClick={() => onPick(star)}
          aria-label={`${star} stars`}
        >
          <Star size={18} fill={value >= star ? "currentColor" : "none"} />
          <span>{star}</span>
        </button>
      ))}
    </div>
  );
}

function DayRatingSelector({ value, onPick }) {
  return (
    <div className="rating-row">
      {DAY_RATING_STARS.map((star) => (
        <button
          key={star}
          type="button"
          className={cx("rating-button", value === star && "active")}
          onClick={() => onPick(star)}
          aria-label={`${star} star day`}
        >
          <Star size={18} fill={value >= star ? "currentColor" : "none"} />
        </button>
      ))}
    </div>
  );
}

function MoodSelector({ value, onPick }) {
  return (
    <div className="mood-grid">
      {MOOD_OPTIONS.map((item) => {
        const Icon = MOOD_ICONS[item.key] ?? Circle;
        return (
          <button
            key={item.key}
            type="button"
            className={cx("mood-card", value === item.key && "active")}
            onClick={() => onPick(item.key)}
          >
            <Icon size={20} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ReminderDialog({ value, onChange, onClose, onSave, busy, copy }) {
  function toggleRepeatDay(day) {
    onChange((current) => {
      const currentDays = normalizeRepeatDays(current.reminder_repeat_days);
      const nextDays = currentDays.includes(day)
        ? currentDays.filter((item) => item !== day)
        : [...currentDays, day].sort((a, b) => a - b);

      return { ...current, reminder_repeat_days: nextDays.length ? nextDays : currentDays };
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Reminder</p>
            <h3 className="modal-title">{value.name}</h3>
          </div>
          <IconButton label="Close" icon={X} onClick={onClose} />
        </div>

        <label className="switch-row">
          <input
            type="checkbox"
            checked={value.reminder_enabled}
            onChange={(event) =>
              onChange((current) => ({ ...current, reminder_enabled: event.target.checked }))
            }
          />
          <span>
            <strong>Enable reminder</strong>
            <small>{copy.permission}</small>
          </span>
        </label>

        <div className="form-grid">
          <Field label="Time">
            <input
              type="time"
              disabled={!value.reminder_enabled}
              value={value.reminder_time}
              onChange={(event) =>
                onChange((current) => ({ ...current, reminder_time: event.target.value }))
              }
            />
          </Field>

          <Field label="Later minutes">
            <input
              type="number"
              min="5"
              max="240"
              disabled={!value.reminder_enabled}
              value={value.reminder_snooze_minutes}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  reminder_snooze_minutes: event.target.value
                }))
              }
            />
          </Field>
        </div>

        <div className="field">
          <span className="field-label">Repeat days</span>
          <div className="weekday-strip">
            {WEEKDAY_LABELS.map((label, index) => (
              <button
                key={`${label}_${index}_reminder`}
                type="button"
                disabled={!value.reminder_enabled}
                className={cx(
                  "weekday-chip",
                  normalizeRepeatDays(value.reminder_repeat_days).includes(index) && "active"
                )}
                onClick={() => toggleRepeatDay(index)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <Field label="Custom text">
          <textarea
            disabled={!value.reminder_enabled}
            value={value.reminder_message}
            placeholder="Example: Time to check this habit."
            onChange={(event) =>
              onChange((current) => ({ ...current, reminder_message: event.target.value }))
            }
          />
        </Field>

        <div className="button-row">
          <button type="button" className="primary-button" onClick={onSave} disabled={busy}>
            {busy ? "Saving..." : "Save reminder"}
          </button>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [date, setDate] = useState(formatDateInput());
  const [entry, setEntry] = useState(null);
  const [habits, setHabits] = useState([]);
  const [habitLog, setHabitLog] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [authMode, setAuthMode] = useState("signin");
  const [authForm, setAuthForm] = useState({ email: "", password: "" });
  const [newHabit, setNewHabit] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [reminderEditor, setReminderEditor] = useState(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [activeTab, setActiveTab] = useState("today");
  const [profileView, setProfileView] = useState("home");
  const [morePanel, setMorePanel] = useState("settings");
  const [settings, setSettings] = useState(loadAppSettings);

  const longPressTimerRef = useRef(null);
  const longPressLockRef = useRef("");
  const habitsRef = useRef([]);
  const dateRef = useRef(date);
  const pendingEntryPatchRef = useRef({});
  const pendingEntryDateRef = useRef(date);
  const saveTimeoutRef = useRef(null);

  const copy = HELP_TEXT[settings.languageMode] ?? HELP_TEXT.mixed;
  const weekday = useMemo(() => weekdayFromDate(date), [date]);
  const sleepDuration = useMemo(
    () => calculateSleepDuration(entry?.sleep_time, entry?.wake_time).label,
    [entry?.sleep_time, entry?.wake_time]
  );
  const doneCount = useMemo(
    () => habits.filter((habit) => habitLog[habit.id]).length,
    [habits, habitLog]
  );
  const progress = habits.length ? Math.round((doneCount / habits.length) * 100) : 0;
  const prayerHabits = useMemo(
    () => habits.filter((habit) => habit.category === "spiritual"),
    [habits]
  );

  const load = useCallback(async (targetDate) => {
    setLoading(true);

    try {
      await ensureDefaultHabits();
      const [nextSession, state] = await Promise.all([getSession(), getDailyState(targetDate)]);
      setSession(nextSession);
      setEntry(state.entry);
      setHabits(state.habits);
      setHabitLog(state.habitLog);
      setFeedback(null);
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(date);
  }, [date, load]);

  useEffect(() => {
    let unsubscribe = () => {};

    subscribeToAuthChanges((nextSession) => {
      setSession(nextSession);
      load(date);
    }).then((cleanup) => {
      unsubscribe = cleanup;
    });

    return () => unsubscribe();
  }, [date, load]);

  useEffect(() => {
    habitsRef.current = habits;
  }, [habits]);

  useEffect(() => {
    dateRef.current = date;
  }, [date]);

  useEffect(() => {
    window.localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    registerReminderActionListener(async (action) => {
      const habit = habitsRef.current.find((item) => item.id === action.habitId);
      if (!habit) return;

      try {
        if (action.actionId === reminderActionIds.yes) {
          await setHabitStatus(action.entryDate, action.habitId, true);
          setHabitLog((current) => ({ ...current, [action.habitId]: true }));
          setFeedback({ type: "success", message: `${habit.name} ${copy.habitDone}` });
          return;
        }

        if (action.actionId === reminderActionIds.no) {
          await setHabitStatus(action.entryDate, action.habitId, false);
          setHabitLog((current) => ({ ...current, [action.habitId]: false }));
          setFeedback({ type: "success", message: `${habit.name} ${copy.habitNotDone}` });
          return;
        }

        if (action.actionId === reminderActionIds.later) {
          await scheduleLaterReminder(habit, action.snoozeMinutes);
          setFeedback({
            type: "success",
            message: `${habit.name} ${action.snoozeMinutes} ${copy.snoozed}`
          });
        }
      } catch (error) {
        setFeedback({ type: "error", message: error.message });
      }
    });
  }, [copy.habitDone, copy.habitNotDone, copy.snoozed]);

  useEffect(() => {
    registerReminderAppStateListener(() => {
      syncHabitReminderNotifications(habitsRef.current).catch((error) => {
        setFeedback({ type: "error", message: error.message });
      });
    });
  }, []);

  useEffect(() => {
    if (!habits.length) return;

    syncHabitReminderNotifications(habits).catch((error) => {
      setFeedback({ type: "error", message: error.message });
    });
  }, [habits]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  async function persistNow(targetDate, patch, options = {}) {
    setSaving(true);

    try {
      const nextEntry = await saveEntryFields(targetDate, patch);
      setEntry(nextEntry);
      if (options.successMessage) {
        setFeedback({ type: "success", message: options.successMessage });
      }
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving(false);
    }
  }

  async function flushPendingEntrySave() {
    const patch = pendingEntryPatchRef.current;
    const targetDate = pendingEntryDateRef.current;

    if (!Object.keys(patch).length) return;

    pendingEntryPatchRef.current = {};
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    await persistNow(targetDate, patch);
  }

  function persist(patch, options = {}) {
    const immediate = options.immediate ?? true;

    setEntry((current) => ({ ...current, ...patch }));

    if (immediate) {
      const mergedPatch = {
        ...pendingEntryPatchRef.current,
        ...patch
      };
      pendingEntryPatchRef.current = {};
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      return persistNow(dateRef.current, mergedPatch, options);
    }

    pendingEntryDateRef.current = dateRef.current;
    pendingEntryPatchRef.current = {
      ...pendingEntryPatchRef.current,
      ...patch
    };

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      flushPendingEntrySave();
    }, options.delayMs ?? 600);
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();

    try {
      if (authMode === "signin") {
        await signIn(authForm.email, authForm.password);
        setFeedback({ type: "success", message: copy.loginSuccess });
      } else {
        const result = await signUp(authForm.email, authForm.password);
        if (result.needsEmailVerification) {
          setFeedback({ type: "success", message: copy.signupVerify });
          return;
        }
        setFeedback({ type: "success", message: copy.signupSuccess });
      }

      await load(date);
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    }
  }

  async function handleToggleHabit(habitId) {
    try {
      const nextValue = await toggleHabit(date, habitId);
      setHabitLog((current) => ({ ...current, [habitId]: nextValue }));
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    }
  }

  async function handleAddHabit() {
    const trimmed = newHabit.trim();
    if (!trimmed) return;

    try {
      const created = await createHabit(trimmed);
      setHabits((current) => [...current, created]);
      setHabitLog((current) => ({ ...current, [created.id]: false }));
      setNewHabit("");
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    }
  }

  async function handleArchiveHabit(habitId) {
    try {
      await clearHabitReminderNotifications(habitId);
      await archiveHabit(habitId);
      setHabits((current) => current.filter((habit) => habit.id !== habitId));
      setHabitLog((current) => {
        const next = { ...current };
        delete next[habitId];
        return next;
      });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    }
  }

  async function handleLogout() {
    await flushPendingEntrySave();
    await signOut();
    await load(date);
  }

  async function handleDateChange(nextDate) {
    await flushPendingEntrySave();
    setDate(nextDate);
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function openReminderEditor(habit) {
    longPressLockRef.current = "";
    setReminderEditor({
      id: habit.id,
      name: habit.name,
      reminder_enabled: Boolean(habit.reminder_enabled),
      reminder_time: habit.reminder_time ?? "",
      reminder_message: habit.reminder_message ?? "",
      reminder_snooze_minutes: Number(habit.reminder_snooze_minutes ?? 30),
      reminder_repeat_days: normalizeRepeatDays(habit.reminder_repeat_days)
    });
  }

  function startHabitLongPress(habit) {
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressLockRef.current = habit.id;
      openReminderEditor(habit);
    }, 550);
  }

  async function handleSaveReminder() {
    if (!reminderEditor) return;

    if (reminderEditor.reminder_enabled && !reminderEditor.reminder_time) {
      setFeedback({ type: "error", message: copy.noReminderTime });
      return;
    }

    setReminderBusy(true);
    try {
      let exactNeedsAttention = false;

      if (reminderEditor.reminder_enabled) {
        const permission = await ensureReminderPermissions();
        if (!permission.available) {
          throw new Error(copy.permission);
        }

        exactNeedsAttention = permission.exact?.exact === false;
      }

      const updated = await updateHabitReminder(reminderEditor.id, {
        reminder_enabled: reminderEditor.reminder_enabled,
        reminder_time: reminderEditor.reminder_time,
        reminder_message: reminderEditor.reminder_message.trim(),
        reminder_snooze_minutes: Number(reminderEditor.reminder_snooze_minutes || 30),
        reminder_repeat_days: normalizeRepeatDays(reminderEditor.reminder_repeat_days)
      });

      setHabits((current) =>
        current.map((habit) => (habit.id === updated.id ? { ...habit, ...updated } : habit))
      );
      setFeedback({
        type: exactNeedsAttention ? "error" : "success",
        message: exactNeedsAttention ? copy.reminderExact : `${updated.name} ${copy.reminderSaved}`
      });
      longPressLockRef.current = "";
      setReminderEditor(null);
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setReminderBusy(false);
    }
  }

  function openMore(panel = "settings") {
    setProfileView("more");
    setMorePanel(panel);
    setActiveTab("profile");
  }

  function renderHabitCards(items = habits, compact = false) {
    if (!items.length) {
      return <div className="empty-state">No habits yet.</div>;
    }

    return (
      <div className={cx("habit-list", compact && "compact")}>
        {items.map((habit) => {
          const done = Boolean(habitLog[habit.id]);
          return (
            <article
              key={habit.id}
              className={cx("habit-item", done && "done")}
              onPointerDown={(event) => {
                if (event.pointerType === "touch") {
                  startHabitLongPress(habit);
                }
              }}
              onPointerUp={clearLongPressTimer}
              onPointerCancel={clearLongPressTimer}
              onPointerLeave={clearLongPressTimer}
            >
              <button
                type="button"
                className="habit-check"
                onClick={() => {
                  if (longPressLockRef.current === habit.id) {
                    longPressLockRef.current = "";
                    return;
                  }
                  handleToggleHabit(habit.id);
                }}
                aria-label={`Toggle ${habit.name}`}
              >
                {done ? <Check size={22} /> : <Circle size={22} />}
              </button>
              <div className="habit-content">
                <strong>{habit.name}</strong>
                <span>{habit.category || "habit"} · {describeReminder(habit)}</span>
              </div>
              <IconButton label={`Reminder for ${habit.name}`} icon={Bell} onClick={() => openReminderEditor(habit)} />
              <IconButton label={`Remove ${habit.name}`} icon={X} onClick={() => handleArchiveHabit(habit.id)} />
            </article>
          );
        })}
      </div>
    );
  }

  function renderTodayFocus() {
    if (settings.todayFocus === "prayer") {
      return (
        <section className="card">
          <SectionHeader eyebrow="Focus" title="Prayer Routine" />
          {renderHabitCards(prayerHabits.length ? prayerHabits : habits, true)}
        </section>
      );
    }

    if (settings.todayFocus === "moodSleep") {
      return (
        <section className="card">
          <SectionHeader eyebrow="Focus" title="Mood & Sleep" />
          <div className="metric-grid">
            <div className="metric-card sky">
              <Moon size={20} />
              <span>Sleep</span>
              <strong>{sleepDuration || "Not set"}</strong>
            </div>
            <div className="metric-card coral">
              <Heart size={20} />
              <span>Mood</span>
              <strong>{entry?.mood_label || "Pick mood"}</strong>
            </div>
          </div>
          <MoodSelector value={entry?.mood_key ?? ""} onPick={(value) => persist({ mood_key: value })} />
        </section>
      );
    }

    return (
      <section className="card">
        <SectionHeader
          eyebrow="Focus"
          title="Habit Progress"
          action={<span className="progress-pill">{progress}%</span>}
        />
        <div className="progress-track" aria-label={`${progress}% complete`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        {renderHabitCards(habits, true)}
      </section>
    );
  }

  function renderTodayTab() {
    return (
      <div className="screen-stack">
        <section className="today-summary">
          <div>
            <p className="eyebrow">MeTrack</p>
            <h1>{formatDateLabel(date)}</h1>
            <span>{doneCount}/{habits.length} habits complete</span>
          </div>
          <div className="summary-ring" style={{ "--progress": `${progress * 3.6}deg` }}>
            <strong>{progress}%</strong>
          </div>
        </section>

        {renderTodayFocus()}

        <section className="card">
          <SectionHeader eyebrow="Daily" title="Sleep & Screen" />
          <div className="form-grid">
            <Field label="Sleep time">
              <input
                type="time"
                value={entry.sleep_time ?? ""}
                onChange={(event) => persist({ sleep_time: event.target.value })}
              />
            </Field>
            <Field label="Wake time">
              <input
                type="time"
                value={entry.wake_time ?? ""}
                onChange={(event) => persist({ wake_time: event.target.value })}
              />
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Duration">
              <input type="text" disabled value={sleepDuration || "Auto"} />
            </Field>
            <Field label="Screen time">
              <input
                type="text"
                placeholder="2h 10m"
                value={entry.screen_time ?? ""}
                onChange={(event) => persist({ screen_time: event.target.value }, { immediate: false })}
              />
            </Field>
          </div>
          <Field label="Sleep quality">
            <StarSelector value={entry.sleep_quality ?? 0} onPick={(value) => persist({ sleep_quality: value })} />
          </Field>
          <Field label="Sleep note">
            <textarea
              value={entry.sleep_quality_note ?? ""}
              placeholder="Optional sleep note"
              onChange={(event) => persist({ sleep_quality_note: event.target.value }, { immediate: false })}
            />
          </Field>
        </section>

        <section className="card">
          <SectionHeader eyebrow="Custom" title="Add Habit" />
          <div className="add-row">
            <input
              type="text"
              placeholder="Example: Evening walk"
              value={newHabit}
              onChange={(event) => setNewHabit(event.target.value)}
            />
            <IconButton label="Add habit" icon={Plus} className="primary-icon" onClick={handleAddHabit} />
          </div>
        </section>
      </div>
    );
  }

  function renderReflectTab() {
    return (
      <div className="screen-stack">
        <section className="card">
          <SectionHeader eyebrow="Reflect" title="Mood & Rating" />
          <MoodSelector value={entry.mood_key ?? ""} onPick={(value) => persist({ mood_key: value })} />
          <Field label="Day rating">
            <DayRatingSelector value={entry.day_rating ?? 0} onPick={(value) => persist({ day_rating: value })} />
          </Field>
        </section>

        <section className="card">
          <SectionHeader eyebrow="Journal" title="Daily Notes" />
          <Field label="Best moment">
            <textarea
              value={entry.best_moment ?? ""}
              placeholder="What went well today?"
              onChange={(event) => persist({ best_moment: event.target.value }, { immediate: false })}
            />
          </Field>
          <Field label="Could improve">
            <textarea
              value={entry.improved_today ?? ""}
              placeholder="What could be better?"
              onChange={(event) => persist({ improved_today: event.target.value }, { immediate: false })}
            />
          </Field>
          <Field label="Gratitude">
            <textarea
              value={entry.gratitude ?? ""}
              placeholder="What are you thankful for?"
              onChange={(event) => persist({ gratitude: event.target.value }, { immediate: false })}
            />
          </Field>
          <Field label="Review">
            <textarea
              value={entry.review ?? ""}
              placeholder="Short review of the day"
              onChange={(event) => persist({ review: event.target.value }, { immediate: false })}
            />
          </Field>
        </section>

        <section className="card">
          <SectionHeader eyebrow="Tomorrow" title="Next Focus" />
          <Field label="Goals achieved">
            <textarea
              value={entry.goals_achieved ?? ""}
              placeholder="What did you complete?"
              onChange={(event) => persist({ goals_achieved: event.target.value }, { immediate: false })}
            />
          </Field>
          <Field label="Still working on">
            <textarea
              value={entry.still_working_on ?? ""}
              placeholder="What is still active?"
              onChange={(event) => persist({ still_working_on: event.target.value }, { immediate: false })}
            />
          </Field>
          <Field label="Focus for tomorrow">
            <textarea
              value={entry.focus_for_tomorrow ?? ""}
              placeholder="Tomorrow's main focus"
              onChange={(event) => persist({ focus_for_tomorrow: event.target.value }, { immediate: false })}
            />
          </Field>
          <Field label="Intentions">
            <textarea
              value={entry.intentions_for_tomorrow ?? ""}
              placeholder="How do you want to show up tomorrow?"
              onChange={(event) => persist({ intentions_for_tomorrow: event.target.value }, { immediate: false })}
            />
          </Field>
        </section>
      </div>
    );
  }

  function renderAuthCard() {
    return (
      <form className="card auth-card" onSubmit={handleAuthSubmit}>
        <SectionHeader eyebrow="Account" title={authMode === "signin" ? "Sign In" : "Create Account"} />
        <p className="helper-text">{copy.authIntro}</p>
        <SegmentedControl
          value={authMode}
          onChange={setAuthMode}
          options={[
            { value: "signin", label: "Login" },
            { value: "signup", label: "Create" }
          ]}
        />
        <Field label="Email">
          <input
            type="email"
            required
            value={authForm.email}
            onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            required
            value={authForm.password}
            onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
          />
        </Field>
        <button type="submit" className="primary-button">
          {authMode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
    );
  }

  function renderSettingsPanel() {
    return (
      <div className="screen-stack">
        <section className="card">
          <SectionHeader eyebrow="Settings" title="App Preferences" />
          <Field label="Language mode">
            <SegmentedControl
              value={settings.languageMode}
              onChange={(value) => {
                setSettings((current) => ({ ...current, languageMode: value }));
                setFeedback({ type: "success", message: HELP_TEXT[value]?.settingsSaved ?? HELP_TEXT.mixed.settingsSaved });
              }}
              options={[
                { value: "mixed", label: "Mixed" },
                { value: "english", label: "English" }
              ]}
            />
          </Field>
          <Field label="Today focus">
            <SegmentedControl
              value={settings.todayFocus}
              onChange={(value) => {
                setSettings((current) => ({ ...current, todayFocus: value }));
                setFeedback({ type: "success", message: copy.settingsSaved });
              }}
              options={[
                { value: "habits", label: "Habits" },
                { value: "prayer", label: "Prayer" },
                { value: "moodSleep", label: "Mood" }
              ]}
            />
          </Field>
        </section>

        <section className="card">
          <SectionHeader eyebrow="System" title="Connection" />
          <div className="profile-row">
            <ShieldCheck size={20} />
            <div>
              <strong>{hasSupabaseConfig ? "Supabase connected" : "Environment pending"}</strong>
              <span>{session?.user ? copy.account : copy.preview}</span>
            </div>
          </div>
          <button type="button" className="secondary-button" onClick={() => load(date)}>
            <RefreshCw size={18} />
            Refresh data
          </button>
        </section>
      </div>
    );
  }

  function renderMorePanel() {
    return (
      <div className="screen-stack">
        <div className="more-header">
          <IconButton label="Back to profile" icon={ArrowLeft} onClick={() => setProfileView("home")} />
          <div>
            <p className="eyebrow">More</p>
            <h1>{morePanel === "settings" ? "Settings" : morePanel === "reminders" ? "Reminders" : "Security"}</h1>
          </div>
        </div>

        <SegmentedControl
          value={morePanel}
          onChange={setMorePanel}
          options={[
            { value: "settings", label: "Settings" },
            { value: "reminders", label: "Reminders" },
            { value: "security", label: "Security" }
          ]}
        />

        {morePanel === "settings" ? renderSettingsPanel() : null}
        {morePanel === "reminders" ? (
          <ReminderCenter embedded setFeedback={setFeedback} onHabitsChange={setHabits} />
        ) : null}
        {morePanel === "security" ? (
          session?.user ? (
            <section className="card">
              <SecurityPanel setFeedback={setFeedback} />
            </section>
          ) : (
            <section className="card empty-state">{copy.noSecurity}</section>
          )
        ) : null}
      </div>
    );
  }

  function renderProfileTab() {
    if (profileView === "more") {
      return renderMorePanel();
    }

    return (
      <div className="screen-stack">
        <section className="card profile-card">
          <div className="avatar-circle">
            <User size={28} />
          </div>
          <div>
            <p className="eyebrow">Profile</p>
            <h1>{session?.user ? "Account Mode" : "Preview Mode"}</h1>
            <p className="helper-text">{session?.user ? copy.account : copy.preview}</p>
          </div>
          {session?.user ? (
            <button type="button" className="secondary-button" onClick={handleLogout}>
              <LogOut size={18} />
              Logout
            </button>
          ) : null}
        </section>

        {!session?.user ? renderAuthCard() : null}

        <section className="card">
          <SectionHeader eyebrow="Customize" title="Quick Settings" />
          <div className="settings-preview">
            <button type="button" onClick={() => openMore("settings")}>
              <Settings size={20} />
              <span>
                <strong>Language & Today focus</strong>
                <small>{settings.languageMode === "english" ? "English only" : "Mixed mode"} · {settings.todayFocus}</small>
              </span>
              <ChevronRight size={18} />
            </button>
            <button type="button" onClick={() => openMore("reminders")}>
              <AlarmClock size={20} />
              <span>
                <strong>Reminders</strong>
                <small>Repeat days, logs, and stats</small>
              </span>
              <ChevronRight size={18} />
            </button>
            <button type="button" onClick={() => openMore("security")}>
              <Lock size={20} />
              <span>
                <strong>Security Center</strong>
                <small>MCP tokens and audit logs</small>
              </span>
              <ChevronRight size={18} />
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (loading || !entry) {
    return (
      <main className="mobile-app-shell loading-shell">
        <div className="loading-card">
          <Sparkles size={24} />
          <span>Loading MeTrack...</span>
        </div>
      </main>
    );
  }

  return (
    <main className="mobile-app-shell">
      <header className="app-topbar">
        <div>
          <p className="eyebrow">MeTrack</p>
          <strong>{activeTab === "today" ? "Today" : activeTab === "reflect" ? "Reflect" : "Profile"}</strong>
        </div>
        <div className="topbar-actions">
          <label className="date-chip">
            <CalendarDays size={18} />
            <input type="date" value={date} onChange={(event) => handleDateChange(event.target.value)} />
          </label>
          <span className={cx("save-chip", saving && "saving")}>{saving ? "Saving" : "Saved"}</span>
        </div>
      </header>

      <div className="weekday-row" aria-label="Weekdays">
        {WEEKDAY_LABELS.map((label, index) => (
          <span key={`${label}_${index}`} className={cx("weekday-chip", weekday === index && "active")}>
            {label}
          </span>
        ))}
      </div>

      {feedback ? (
        <div className={cx("alert", feedback.type === "error" ? "error" : "success")}>
          {feedback.message}
        </div>
      ) : null}

      <section className="app-content">
        {activeTab === "today" ? renderTodayTab() : null}
        {activeTab === "reflect" ? renderReflectTab() : null}
        {activeTab === "profile" ? renderProfileTab() : null}
      </section>

      <nav className="bottom-tabs" aria-label="Primary navigation">
        {[
          { value: "today", label: "Today", icon: Home },
          { value: "reflect", label: "Reflect", icon: Heart },
          { value: "profile", label: "Profile", icon: User }
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.value}
              type="button"
              className={cx(activeTab === tab.value && "active")}
              onClick={() => setActiveTab(tab.value)}
            >
              <Icon size={20} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {reminderEditor ? (
        <ReminderDialog
          value={reminderEditor}
          onChange={setReminderEditor}
          onClose={() => {
            longPressLockRef.current = "";
            setReminderEditor(null);
          }}
          onSave={handleSaveReminder}
          busy={reminderBusy}
          copy={copy}
        />
      ) : null}
    </main>
  );
}
