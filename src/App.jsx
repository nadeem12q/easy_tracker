import { useCallback, useEffect, useMemo, useState } from "react";
import {
  archiveHabit,
  createHabit,
  ensureDefaultHabits,
  getDailyState,
  getSession,
  saveEntryFields,
  signIn,
  signOut,
  signUp,
  subscribeToAuthChanges,
  toggleHabit
} from "./api.js";
import { DAY_RATING_STARS, MOOD_OPTIONS, QUALITY_STARS, WEEKDAY_LABELS } from "./defaults.js";
import { calculateSleepDuration, formatDateInput, weekdayFromDate } from "./lib.js";
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

  async function persist(patch) {
    setSaving(true);

    try {
      const nextEntry = await saveEntryFields(date, patch);
      setEntry(nextEntry);
      setFeedback({ type: "success", message: "Aaj ka tracker save ho gaya." });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving(false);
    }
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
    await signOut();
    await load(date);
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
            <span className="pill">
              {sleepDuration ? `Sleep: ${sleepDuration}` : "Sleep duration auto-calc ready"}
            </span>
            <span className="pill">{saving ? "Saving..." : "Auto-save available"}</span>
          </div>
        </div>

        <aside className="hero-panel">
          <div className="panel-row">
            <Field label="Date">
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
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
              <div className="toolbar">
                <button type="button" className="action secondary" onClick={handleLogout}>
                  Logout
                </button>
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
                onChange={(event) => persist({ screen_time: event.target.value })}
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
              onChange={(event) => persist({ sleep_quality_note: event.target.value })}
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

                <button
                  type="button"
                  className={cx("habit-toggle", habitLog[habit.id] && "checked")}
                  onClick={() => handleToggleHabit(habit.id)}
                  aria-label={`Toggle ${habit.name}`}
                />

                <button
                  type="button"
                  className="tag-button"
                  style={{
                    position: "absolute",
                    left: "18px",
                    bottom: "12px",
                    padding: "6px 10px",
                    fontSize: "0.82rem"
                  }}
                  onClick={() => handleArchiveHabit(habit.id)}
                >
                  Remove
                </button>
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
                onChange={(event) => persist({ best_moment: event.target.value })}
              />
            </div>

            <div className="reflection-block">
              <h3>What could be improved today?</h3>
              <textarea
                value={entry.improved_today ?? ""}
                placeholder="Aaj kya behtar ho sakta tha?"
                onChange={(event) => persist({ improved_today: event.target.value })}
              />
            </div>

            <div className="reflection-block">
              <h3>Gratitude Check</h3>
              <textarea
                value={entry.gratitude ?? ""}
                placeholder="Jitna chahein utna likhein..."
                onChange={(event) => persist({ gratitude: event.target.value })}
              />
            </div>

            <div className="reflection-block">
              <h3>Review</h3>
              <textarea
                value={entry.review ?? ""}
                placeholder="Aaj ke din ka review..."
                onChange={(event) => persist({ review: event.target.value })}
              />
            </div>

            <div className="info-card-grid">
              <div className="info-card">
                <h3>Goals Achieved</h3>
                <textarea
                  value={entry.goals_achieved ?? ""}
                  placeholder="Kya complete hua?"
                  onChange={(event) => persist({ goals_achieved: event.target.value })}
                />
              </div>

              <div className="info-card">
                <h3>Still Working On</h3>
                <textarea
                  value={entry.still_working_on ?? ""}
                  placeholder="Kis cheez par kaam jari hai?"
                  onChange={(event) => persist({ still_working_on: event.target.value })}
                />
              </div>

              <div className="info-card">
                <h3>Focus for Tomorrow</h3>
                <textarea
                  value={entry.focus_for_tomorrow ?? ""}
                  placeholder="Kal ka main focus..."
                  onChange={(event) => persist({ focus_for_tomorrow: event.target.value })}
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
                  onChange={(event) => persist({ intentions_for_tomorrow: event.target.value })}
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
    </main>
  );
}
