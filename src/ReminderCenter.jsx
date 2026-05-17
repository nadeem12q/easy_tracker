import { useEffect, useMemo, useState } from "react";
import {
  getReminderStats,
  listReminderHabits,
  listReminderLogs,
  normalizeRepeatDays,
  saveHabitReminderAdvanced
} from "./reminderApi.js";
import { describeReminder, ensureReminderPermissions, syncHabitReminderNotifications } from "./notifications.js";
import "./reminder-center.css";

const DAY_OPTIONS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" }
];

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

function formatDateTime(value) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}

function defaultEditor(habit) {
  return {
    id: habit.id,
    name: habit.name,
    reminder_enabled: Boolean(habit.reminder_enabled),
    reminder_time: habit.reminder_time ?? "",
    reminder_message: habit.reminder_message ?? "",
    reminder_snooze_minutes: Number(habit.reminder_snooze_minutes ?? 30),
    reminder_repeat_days: normalizeRepeatDays(habit.reminder_repeat_days)
  };
}

export default function ReminderCenter({ setFeedback }) {
  const [habits, setHabits] = useState([]);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({ summary: {} });
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("settings");

  const activeCount = useMemo(() => habits.filter((habit) => habit.reminder_enabled).length, [habits]);

  async function refresh() {
    const [nextHabits, nextLogs, nextStats] = await Promise.all([
      listReminderHabits(),
      listReminderLogs(30),
      getReminderStats(14)
    ]);
    setHabits(nextHabits);
    setLogs(nextLogs);
    setStats(nextStats);
  }

  useEffect(() => {
    refresh().catch((error) => setFeedback?.({ type: "error", message: error.message }));
  }, []);

  function toggleDay(day) {
    setEditor((current) => {
      const currentDays = normalizeRepeatDays(current.reminder_repeat_days);
      const nextDays = currentDays.includes(day)
        ? currentDays.filter((item) => item !== day)
        : [...currentDays, day].sort((a, b) => a - b);
      return { ...current, reminder_repeat_days: nextDays.length ? nextDays : currentDays };
    });
  }

  function setEveryDay() {
    setEditor((current) => ({ ...current, reminder_repeat_days: [0, 1, 2, 3, 4, 5, 6] }));
  }

  function setWeekdaysOnly() {
    setEditor((current) => ({ ...current, reminder_repeat_days: [1, 2, 3, 4, 5] }));
  }

  async function saveReminder() {
    if (!editor) return;
    if (editor.reminder_enabled && !editor.reminder_time) {
      setFeedback?.({ type: "error", message: "Reminder enable karne ke liye time zaroori hai." });
      return;
    }

    setBusy(true);
    try {
      if (editor.reminder_enabled) {
        const permission = await ensureReminderPermissions();
        if (!permission.available) {
          throw new Error("Notification permission allow karein, phir reminder enable hoga.");
        }
      }

      await saveHabitReminderAdvanced(editor.id, {
        reminder_enabled: editor.reminder_enabled,
        reminder_time: editor.reminder_time,
        reminder_message: editor.reminder_message,
        reminder_snooze_minutes: Number(editor.reminder_snooze_minutes || 30),
        reminder_repeat_days: editor.reminder_repeat_days
      });
      const nextHabits = await listReminderHabits();
      setHabits(nextHabits);
      await syncHabitReminderNotifications(nextHabits);
      setEditor(null);
      setFeedback?.({ type: "success", message: "Repeat-day reminder save ho gaya." });
      await refresh();
    } catch (error) {
      setFeedback?.({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="app-shell reminder-center-shell">
      <div className="hero-panel reminder-center-panel">
        <div className="reminder-center-header">
          <div>
            <p className="eyebrow">Reminders</p>
            <h2 className="reminder-center-title">Repeat Days & Logs</h2>
            <p className="subtle-note">
              Har habit ke liye reminder days choose karein. Android notification actions aur logs yahan track honge.
            </p>
          </div>
          <span className="pill">{activeCount} active</span>
        </div>

        <div className="security-tabs">
          <button className={cx("tag-button", tab === "settings" && "active")} type="button" onClick={() => setTab("settings")}>Settings</button>
          <button className={cx("tag-button", tab === "logs" && "active")} type="button" onClick={() => setTab("logs")}>Logs</button>
          <button className={cx("tag-button", tab === "stats" && "active")} type="button" onClick={() => setTab("stats")}>Stats</button>
          <button className="tag-button" type="button" onClick={refresh} disabled={busy}>Refresh</button>
        </div>

        {tab === "settings" ? (
          <div className="reminder-habit-list">
            {habits.map((habit) => (
              <div key={habit.id} className="reminder-habit-row">
                <div>
                  <strong>{habit.name}</strong>
                  <div className="subtle-note">{describeReminder(habit)}</div>
                </div>
                <button type="button" className="action secondary" onClick={() => setEditor(defaultEditor(habit))}>
                  Edit Reminder
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {tab === "logs" ? (
          <div className="audit-list">
            {logs.length ? logs.map((log) => (
              <div key={log.id} className="audit-row">
                <div>
                  <strong>{log.habit_name}</strong>
                  <div className="subtle-note">
                    {log.action} | {log.entry_date} | {formatDateTime(log.created_at)}
                  </div>
                </div>
                <span className="pill">{log.source}</span>
              </div>
            )) : <div className="subtle-note">Abhi reminder logs nahin hain.</div>}
          </div>
        ) : null}

        {tab === "stats" ? (
          <div className="reminder-stats-grid">
            {Object.entries(stats.summary ?? {}).length ? Object.entries(stats.summary).map(([habitName, item]) => (
              <div key={habitName} className="info-card">
                <h3>{habitName}</h3>
                <p className="subtle-note">Scheduled: {item.scheduled} | Fired: {item.fired}</p>
                <p className="subtle-note">Yes: {item.yes} | No: {item.no} | Later: {item.later}</p>
                <p className="subtle-note">Missed: {item.missed}</p>
              </div>
            )) : <div className="subtle-note">Stats tab logs aane ke baad useful hoga.</div>}
          </div>
        ) : null}
      </div>

      {editor ? (
        <div className="modal-backdrop" onClick={() => setEditor(null)}>
          <div className="modal-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Reminder</p>
                <h3 className="modal-title">{editor.name}</h3>
              </div>
              <button type="button" className="action secondary" onClick={() => setEditor(null)}>Close</button>
            </div>

            <label className="switch-row">
              <input
                type="checkbox"
                checked={editor.reminder_enabled}
                onChange={(event) => setEditor((current) => ({ ...current, reminder_enabled: event.target.checked }))}
              />
              <div>
                <strong>Reminder enable karein</strong>
                <div className="subtle-note">Default off hai. User khud on karega.</div>
              </div>
            </label>

            <div className="panel-row">
              <label>
                <span className="field-label">Time</span>
                <input type="time" disabled={!editor.reminder_enabled} value={editor.reminder_time} onChange={(event) => setEditor((current) => ({ ...current, reminder_time: event.target.value }))} />
              </label>
              <label>
                <span className="field-label">Later Minutes</span>
                <input type="number" min="5" max="240" disabled={!editor.reminder_enabled} value={editor.reminder_snooze_minutes} onChange={(event) => setEditor((current) => ({ ...current, reminder_snooze_minutes: event.target.value }))} />
              </label>
            </div>

            <div>
              <span className="field-label">Repeat Days</span>
              <div className="repeat-day-actions">
                <button type="button" className="tag-button" onClick={setEveryDay}>Every day</button>
                <button type="button" className="tag-button" onClick={setWeekdaysOnly}>Weekdays</button>
              </div>
              <div className="repeat-day-row">
                {DAY_OPTIONS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    disabled={!editor.reminder_enabled}
                    className={cx("weekday-chip", normalizeRepeatDays(editor.reminder_repeat_days).includes(day.value) && "active")}
                    onClick={() => toggleDay(day.value)}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>

            <label>
              <span className="field-label">Custom Reminder Text</span>
              <textarea disabled={!editor.reminder_enabled} value={editor.reminder_message} onChange={(event) => setEditor((current) => ({ ...current, reminder_message: event.target.value }))} />
            </label>

            <div className="toolbar">
              <button type="button" className="action" onClick={saveReminder} disabled={busy}>{busy ? "Saving..." : "Save Reminder"}</button>
              <button type="button" className="action secondary" onClick={() => setEditor(null)} disabled={busy}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
