import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  archiveHabit,
  createMcpToken,
  createHabit,
  ensureDefaultHabits,
  getDailyState,
  getSession,
  listMcpTokens,
  revokeMcpToken,
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
import { calculateSleepDuration, formatDateInput, weekdayFromDate } from "./lib.js";
import {
  clearHabitReminderNotifications,
  describeReminder,
  ensureReminderPermissions,
  registerReminderAppStateListener,
  registerReminderActionListener,
  reminderActionIds,
  scheduleLaterReminder,
  syncHabitReminderNotifications
} from "./notifications.js";
import { hasSupabaseConfig } from "./supabase.js";

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

function SectionTitle({ text, emoji }) {
  return (
    <h3 className="sheet-title">
      {text} {emoji ? emoji : ""}
    </h3>
  );
}

function Field({ label, children }) {
  return (
    <label>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function StarSelector({ value, onPick }) {
  return (
    <div className="star-row">
      {QUALITY_STARS.map((star) => (
        <button
          key={star}
          type="button"
          className={cx("star-chip", value === star && "active")}
          onClick={() => onPick(star)}
        >
          {star} Star{star > 1 ? "s" : ""}
        </button>
      ))}
    </div>
  );
}

function MoodSelector({ value, onPick }) {
  return (
    <div className="mood-row">
      {MOOD_OPTIONS.map((item) => (
        <button
          key={item.key}
          type="button"
          className={cx("mood-chip", value === item.key && "active")}
          onClick={() => onPick(item.key)}
        >
          {item.emoji} {item.label}
        </button>
      ))}
    </div>
  );
}

function ReminderDialog({ value, onChange, onClose, onSave, busy }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Reminder</p>
            <h3 className="modal-title">{value.name}</h3>
          </div>
          <button type="button" className="action secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <label className="switch-row">
          <input
            type="checkbox"
            checked={value.reminder_enabled}
            onChange={(event) =>
              onChange((current) => ({ ...current, reminder_enabled: event.target.checked }))
            }
          />
          <div>
            <strong>Daily reminder enable karein</strong>
            <div className="subtle-note">Default off hai. User khud on karega.</div>
          </div>
        </label>

        <div className="panel-row">
          <Field label="Reminder Time">
            <input
              type="time"
              disabled={!value.reminder_enabled}
              value={value.reminder_time}
              onChange={(event) =>
                onChange((current) => ({ ...current, reminder_time: event.target.value }))
              }
            />
          </Field>

          <Field label="Later Minutes">
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

        <Field label="Custom Reminder Text">
          <textarea
            disabled={!value.reminder_enabled}
            value={value.reminder_message}
            placeholder="Misal: Fajar ka waqt ho gaya. Kya aap ne ye habit kar li hai?"
            onChange={(event) =>
              onChange((current) => ({ ...current, reminder_message: event.target.value }))
            }
          />
        </Field>

        <div className="auth-note">
          Notification mein teen actions honge: <strong>Yes</strong>, <strong>No</strong>, aur{" "}
          <strong>Later</strong>. Android app mein yeh zyada strong tareeqay se kaam karega.
        </div>

        <div className="toolbar">
          <button type="button" className="action" onClick={onSave} disabled={busy}>
            {busy ? "Saving..." : "Save Reminder"}
          </button>
          <button type="button" className="action secondary" onClick={onClose} disabled={busy}>
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
  const [mcpTokens, setMcpTokens] = useState([]);
  const [tokenLabel, setTokenLabel] = useState("Primary Agent");
  const [createdToken, setCreatedToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [reminderEditor, setReminderEditor] = useState(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => {
    return window.localStorage.getItem("metrack-welcome-dismissed") !== "yes";
  });
  const longPressTimerRef = useRef(null);
  const longPressLockRef = useRef("");
  const habitsRef = useRef([]);
  const dateRef = useRef(date);
  const pendingEntryPatchRef = useRef({});
  const pendingEntryDateRef = useRef(date);
  const saveTimeoutRef = useRef(null);

  const weekday = useMemo(() => weekdayFromDate(date), [date]);
  const sleepDuration = useMemo(
    () => calculateSleepDuration(entry?.sleep_time, entry?.wake_time).label,
    [entry?.sleep_time, entry?.wake_time]
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
    if (!session?.user) {
      setMcpTokens([]);
      setCreatedToken("");
      return;
    }

    listMcpTokens()
      .then(setMcpTokens)
      .catch((error) => {
        setFeedback({ type: "error", message: error.message });
      });
  }, [session?.user]);

  useEffect(() => {
    habitsRef.current = habits;
  }, [habits]);

  useEffect(() => {
    dateRef.current = date;
  }, [date]);

  useEffect(() => {
    registerReminderActionListener(async (action) => {
      const habit = habitsRef.current.find((item) => item.id === action.habitId);
      if (!habit) {
        return;
      }

      try {
        if (action.actionId === reminderActionIds.yes) {
          await setHabitStatus(action.entryDate, action.habitId, true);
          setHabitLog((current) => ({ ...current, [action.habitId]: true }));
          setFeedback({ type: "success", message: `${habit.name} done mark ho gayi.` });
          return;
        }

        if (action.actionId === reminderActionIds.no) {
          await setHabitStatus(action.entryDate, action.habitId, false);
          setHabitLog((current) => ({ ...current, [action.habitId]: false }));
          setFeedback({ type: "success", message: `${habit.name} abhi not done par set ho gayi.` });
          return;
        }

        if (action.actionId === reminderActionIds.later) {
          await scheduleLaterReminder(habit, action.snoozeMinutes);
          setFeedback({
            type: "success",
            message: `${habit.name} ka reminder ${action.snoozeMinutes} minutes baad dobara aayega.`
          });
        }
      } catch (error) {
        setFeedback({ type: "error", message: error.message });
      }
    });
  }, []);

  useEffect(() => {
    registerReminderAppStateListener(() => {
      syncHabitReminderNotifications(habitsRef.current).catch((error) => {
        setFeedback({ type: "error", message: error.message });
      });
    });
  }, []);

  useEffect(() => {
    if (!habits.length) {
      return;
    }

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

    if (!Object.keys(patch).length) {
      return;
    }

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
        setFeedback({ type: "success", message: "Login ho gaya." });
      } else {
        const result = await signUp(authForm.email, authForm.password);
        if (result.needsEmailVerification) {
          setFeedback({
            type: "success",
            message: "Account create ho gaya. Email verify karke phir login karein."
          });
          return;
        }
        setFeedback({ type: "success", message: "Account create ho gaya." });
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
      reminder_snooze_minutes: Number(habit.reminder_snooze_minutes ?? 30)
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
      setFeedback({ type: "error", message: "Reminder enable karne ke liye time zaroori hai." });
      return;
    }

    setReminderBusy(true);
    try {
      let exactNeedsAttention = false;

      if (reminderEditor.reminder_enabled) {
        const permission = await ensureReminderPermissions();
        if (!permission.available) {
          throw new Error("Notification permission grant kiye baghair reminder enable nahin ho sakta.");
        }

        exactNeedsAttention = permission.exact?.exact === false;
      }

      const updated = await updateHabitReminder(reminderEditor.id, {
        reminder_enabled: reminderEditor.reminder_enabled,
        reminder_time: reminderEditor.reminder_time,
        reminder_message: reminderEditor.reminder_message.trim(),
        reminder_snooze_minutes: Number(reminderEditor.reminder_snooze_minutes || 30)
      });

      setHabits((current) =>
        current.map((habit) => (habit.id === updated.id ? { ...habit, ...updated } : habit))
      );
      setFeedback({
        type: exactNeedsAttention ? "error" : "success",
        message: exactNeedsAttention
          ? `${updated.name} ka reminder save ho gaya. Android exact alarm setting bhi allow kar dein aur app dobara khol kar check karein.`
          : `${updated.name} ka reminder save ho gaya.`
      });
      longPressLockRef.current = "";
      setReminderEditor(null);
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setReminderBusy(false);
    }
  }

  async function handleCreateToken() {
    const trimmed = tokenLabel.trim();
    if (!trimmed) return;

    setTokenBusy(true);
    try {
      const created = await createMcpToken({ label: trimmed });
      setCreatedToken(created.token);
      setMcpTokens((current) => [created.record, ...current]);
      setFeedback({
        type: "success",
        message: "Naya MCP token generate ho gaya. Isay sirf trusted agent ke saath use karein."
      });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setTokenBusy(false);
    }
  }

  async function handleRevokeToken(tokenId) {
    setTokenBusy(true);
    try {
      await revokeMcpToken(tokenId);
      setMcpTokens((current) => current.filter((item) => item.id !== tokenId));
      setFeedback({ type: "success", message: "MCP token revoke kar diya gaya." });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setTokenBusy(false);
    }
  }

  function dismissWelcome(mode = "preview") {
    if (mode === "preview") {
      window.localStorage.setItem("metrack-welcome-dismissed", "yes");
    }
    setShowWelcome(false);
  }

  if (loading || !entry) {
    return (
      <main className="app-shell">
        <div className="pill">Loading MeTrack...</div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="title-stack">
          <p className="eyebrow">Daily</p>
          <h1 className="display-title">Routine Tracker</h1>
          <p className="hero-copy">
            MeTrack aap ke printed tracker ki clean feel ko digital form mein rakhta hai. Daily
            routine, reflection aur mood sab aik hi jagah, minimal aur distraction-free layout ke
            saath.
          </p>

          <div className="toolbar">
            <span className="pill">{hasSupabaseConfig ? "Supabase Connected" : "Env Pending"}</span>
            <span className="pill">{session?.user ? "Account Mode" : "Preview Mode"}</span>
            <span className="pill">
              {sleepDuration ? `Sleep: ${sleepDuration}` : "Sleep duration auto-calc ready"}
            </span>
            <span className="pill">{saving ? "Saving..." : "Auto-save available"}</span>
          </div>

          {!session?.user ? (
            <div className="guest-note">
              <strong>Preview mode:</strong> app khul jati hai, lekin permanent sync aur MCP-based
              account automation ke liye login ya signup zaroori hai.
            </div>
          ) : null}
        </div>

        <aside className="hero-panel">
          <div className="panel-row">
            <Field label="Date">
              <input type="date" value={date} onChange={(event) => handleDateChange(event.target.value)} />
            </Field>

            <div>
              <span className="field-label">Day</span>
              <div className="weekday-strip">
                {WEEKDAY_LABELS.map((label, index) => (
                  <span key={`${label}_${index}`} className={cx("weekday-chip", weekday === index && "active")}>
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {session?.user ? (
            <div className="panel-stack">
              <div className="section-divider" />
              <span className="field-label">Signed In</span>
              <div className="subtle-note">{session.user.email || "Active user"}</div>
              <div className="subtle-note">
                Aap ka data ab aap ke account ke saath Supabase par sync ho raha hai.
              </div>
              <div className="toolbar">
                <button type="button" className="action secondary" onClick={handleLogout}>
                  Logout
                </button>
              </div>

              <div className="section-divider" />
              <span className="field-label">MCP Access Tokens</span>
              <div className="subtle-note">
                Password ki jagah ab agent access ke liye yeh tokens use karein. Token sirf aik
                dafa poora show hota hai.
              </div>
              <div className="panel-row">
                <Field label="Token Label">
                  <input
                    type="text"
                    value={tokenLabel}
                    onChange={(event) => setTokenLabel(event.target.value)}
                    placeholder="Primary Agent"
                  />
                </Field>
                <div style={{ display: "flex", alignItems: "end" }}>
                  <button type="button" className="action" onClick={handleCreateToken} disabled={tokenBusy}>
                    {tokenBusy ? "Working..." : "Generate Token"}
                  </button>
                </div>
              </div>

              {createdToken ? (
                <div className="token-box">
                  <strong>New Token</strong>
                  <code>{createdToken}</code>
                </div>
              ) : null}

              <div className="token-list">
                {mcpTokens.length ? (
                  mcpTokens.map((token) => (
                    <div key={token.id} className="token-row">
                      <div>
                        <strong>{token.label}</strong>
                        <div className="subtle-note">
                          Prefix: {token.token_prefix} | Expires:{" "}
                          {token.expires_at ? new Date(token.expires_at).toLocaleDateString() : "n/a"}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="action secondary"
                        onClick={() => handleRevokeToken(token.id)}
                        disabled={tokenBusy}
                      >
                        Revoke
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="subtle-note">Abhi koi active MCP token nahin hai.</div>
                )}
              </div>
            </div>
          ) : (
            <form className="panel-stack" onSubmit={handleAuthSubmit}>
              <div className="section-divider" />

              <div className="toolbar">
                <button
                  type="button"
                  className={cx("tag-button", authMode === "signin" && "active")}
                  onClick={() => setAuthMode("signin")}
                >
                  Login
                </button>
                <button
                  type="button"
                  className={cx("tag-button", authMode === "signup" && "active")}
                  onClick={() => setAuthMode("signup")}
                >
                  Create Account
                </button>
              </div>

              <div className="auth-note">
                Account banane ke baad aap ka tracker, reflections, aur habits aap ke personal
                account mein save ho jayengi. Phir MCP server bhi isi account data ko use kar sake
                ga.
              </div>

              <Field label="Email">
                <input
                  type="email"
                  required
                  value={authForm.email}
                  onChange={(event) =>
                    setAuthForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </Field>

              <Field label="Password">
                <input
                  type="password"
                  required
                  value={authForm.password}
                  onChange={(event) =>
                    setAuthForm((current) => ({ ...current, password: event.target.value }))
                  }
                />
              </Field>

              <button type="submit" className="action">
                {authMode === "signin" ? "Email se login" : "Email se signup"}
              </button>
            </form>
          )}
        </aside>
      </section>

      {feedback ? (
        <div className={cx("alert", feedback.type === "error" ? "error" : "success")}>
          {feedback.message}
        </div>
      ) : null}

      {showWelcome && !session?.user ? (
        <section className="welcome-panel">
          <div className="welcome-copy">
            <p className="eyebrow">Start Here</p>
            <h2 className="welcome-title">MeTrack ko do tareeqon se use kar sakte hain</h2>
            <p className="welcome-text">
              Preview mode mein app dekh sakte hain. Account mode mein aap ka data save hota hai,
              default habits milti hain, aur MCP/LLM automation bhi aap ke account ke saath kaam
              karti hai.
            </p>
            <div className="welcome-points">
              <div className="welcome-point">
                <strong>Preview:</strong> bina account app ka feel samajh lo.
              </div>
              <div className="welcome-point">
                <strong>Account:</strong> personal sync, backend save, aur future cross-device use.
              </div>
              <div className="welcome-point">
                <strong>MCP ready:</strong> agent ko bol kar tracker fill aur analyze karwa sakte ho.
              </div>
            </div>
          </div>

          <div className="welcome-actions">
            <button
              type="button"
              className="action"
              onClick={() => {
                setAuthMode("signup");
                dismissWelcome("account");
              }}
            >
              Account Create Karain
            </button>
            <button
              type="button"
              className="action secondary"
              onClick={() => {
                setAuthMode("signin");
                dismissWelcome("account");
              }}
            >
              Mere Pas Account Hai
            </button>
            <button type="button" className="text-action" onClick={() => dismissWelcome("preview")}>
              Pehle preview dekh leta hoon
            </button>
          </div>
        </section>
      ) : null}

      <section className="page-grid">
        <section className="sheet">
          <SectionTitle text="Daily Routine" emoji="✓" />

          <div className="inline-grid">
            <Field label="Sleep Time">
              <input
                type="time"
                value={entry.sleep_time ?? ""}
                onChange={(event) => persist({ sleep_time: event.target.value })}
              />
            </Field>

            <Field label="Wake-up Time">
              <input
                type="time"
                value={entry.wake_time ?? ""}
                onChange={(event) => persist({ wake_time: event.target.value })}
              />
            </Field>
          </div>

          <div className="inline-grid">
            <Field label="Duration">
              <input
                type="text"
                disabled
                value={sleepDuration || "Auto-calculated after times are picked"}
              />
            </Field>

            <Field label="Screen Time">
              <input
                type="text"
                placeholder="2h 10m"
                value={entry.screen_time ?? ""}
                onChange={(event) =>
                  persist({ screen_time: event.target.value }, { immediate: false })
                }
              />
            </Field>
          </div>

          <div className="reflection-block">
            <h3>Sleep Quality</h3>
            <StarSelector value={entry.sleep_quality ?? 0} onPick={(value) => persist({ sleep_quality: value })} />
            <div style={{ marginTop: "12px" }} />
            <textarea
              value={entry.sleep_quality_note ?? ""}
              placeholder="Agar quality ke saath koi note likhna ho to yahan likhein..."
              onChange={(event) =>
                persist({ sleep_quality_note: event.target.value }, { immediate: false })
              }
            />
          </div>

          <div className="section-divider" />

          <div className="habit-grid">
            {habits.map((habit) => (
              <div
                key={habit.id}
                className={cx("habit-card", habitLog[habit.id] && "done")}
                style={{ background: habit.color || "var(--mint)" }}
              >
                <h3 className="habit-name">{habit.name}</h3>
                <div className="habit-subtitle">{habit.category || "habit"}</div>
                <div className="habit-reminder-note">{describeReminder(habit)}</div>

                <button
                  type="button"
                  className={cx("habit-toggle", habitLog[habit.id] && "checked")}
                  onClick={() => {
                    if (longPressLockRef.current === habit.id) {
                      longPressLockRef.current = "";
                      return;
                    }

                    handleToggleHabit(habit.id);
                  }}
                  aria-label={`Toggle ${habit.name}`}
                />

                <div
                  className="habit-card-overlay"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openReminderEditor(habit);
                  }}
                  onPointerDown={(event) => {
                    if (event.pointerType === "touch") {
                      startHabitLongPress(habit);
                    }
                  }}
                  onPointerUp={clearLongPressTimer}
                  onPointerCancel={clearLongPressTimer}
                  onPointerLeave={clearLongPressTimer}
                />

                <div className="habit-card-actions">
                  <button
                    type="button"
                    className="tag-button"
                    style={{ padding: "6px 10px", fontSize: "0.82rem" }}
                    onClick={() => openReminderEditor(habit)}
                  >
                    Reminder
                  </button>
                  <button
                    type="button"
                    className="tag-button"
                    style={{ padding: "6px 10px", fontSize: "0.82rem" }}
                    onClick={() => handleArchiveHabit(habit.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="section-divider" />

          <div className="panel-row">
            <Field label="New Custom Habit">
              <input
                type="text"
                placeholder="Example: Evening Walk"
                value={newHabit}
                onChange={(event) => setNewHabit(event.target.value)}
              />
            </Field>

            <div style={{ display: "flex", alignItems: "end" }}>
              <button type="button" className="action" onClick={handleAddHabit}>
                Add Habit
              </button>
            </div>
          </div>
        </section>

        <section className="sheet">
          <SectionTitle text="Reflection & Review" emoji="✍️" />

          <div className="reflection-grid">
            <div className="reflection-block">
              <h3>Today, I am thankful for... Best Moment of the Day</h3>
              <textarea
                value={entry.best_moment ?? ""}
                placeholder="Jo acha hua, jo yaad rakhna hai, sab yahan likh sakte hain..."
                onChange={(event) => persist({ best_moment: event.target.value }, { immediate: false })}
              />
            </div>

            <div className="reflection-block">
              <h3>What could be improved today?</h3>
              <textarea
                value={entry.improved_today ?? ""}
                placeholder="Aaj kya behtar ho sakta tha?"
                onChange={(event) =>
                  persist({ improved_today: event.target.value }, { immediate: false })
                }
              />
            </div>

            <div className="reflection-block">
              <h3>Gratitude Check</h3>
              <textarea
                value={entry.gratitude ?? ""}
                placeholder="Jitna chahein utna likhein..."
                onChange={(event) => persist({ gratitude: event.target.value }, { immediate: false })}
              />
            </div>

            <div className="reflection-block">
              <h3>Review</h3>
              <textarea
                value={entry.review ?? ""}
                placeholder="Aaj ke din ka review..."
                onChange={(event) => persist({ review: event.target.value }, { immediate: false })}
              />
            </div>

            <div className="info-card-grid">
              <div className="info-card">
                <h3>Goals Achieved</h3>
                <textarea
                  value={entry.goals_achieved ?? ""}
                  placeholder="Kya complete hua?"
                  onChange={(event) =>
                    persist({ goals_achieved: event.target.value }, { immediate: false })
                  }
                />
              </div>

              <div className="info-card">
                <h3>Still Working On</h3>
                <textarea
                  value={entry.still_working_on ?? ""}
                  placeholder="Kis cheez par kaam jari hai?"
                  onChange={(event) =>
                    persist({ still_working_on: event.target.value }, { immediate: false })
                  }
                />
              </div>

              <div className="info-card">
                <h3>Focus for Tomorrow</h3>
                <textarea
                  value={entry.focus_for_tomorrow ?? ""}
                  placeholder="Kal ka main focus..."
                  onChange={(event) =>
                    persist({ focus_for_tomorrow: event.target.value }, { immediate: false })
                  }
                />
              </div>
            </div>

            <div className="split-grid">
              <div className="reflection-block">
                <h3>Mood Tracker</h3>
                <MoodSelector value={entry.mood_key ?? ""} onPick={(value) => persist({ mood_key: value })} />

                <div className="section-divider" />

                <h3>Day Rating</h3>
                <div className="star-row">
                  {DAY_RATING_STARS.map((star) => (
                    <button
                      key={star}
                      type="button"
                      className={cx("star-chip", entry.day_rating === star && "active")}
                      onClick={() => persist({ day_rating: star })}
                    >
                      {"★".repeat(star)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="reflection-block">
                <h3>Intentions for Tomorrow</h3>
                <textarea
                  value={entry.intentions_for_tomorrow ?? ""}
                  placeholder="Kal kis niyyat ke saath start karna hai?"
                  onChange={(event) =>
                    persist({ intentions_for_tomorrow: event.target.value }, { immediate: false })
                  }
                />
              </div>
            </div>
          </div>

          <p className="footer-note">
            Is app ko env variables ke zariye Supabase se connect kiya jata hai. Agar env abhi set
            na ho to app placeholder mode mein load hogi.
          </p>
        </section>
      </section>

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
        />
      ) : null}
    </main>
  );
}
