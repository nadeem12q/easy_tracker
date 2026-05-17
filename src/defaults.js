export const DEFAULT_HABITS = [
  { name: "3 Meals", color: "var(--lavender)", category: "nutrition", is_binary: true },
  { name: "Workout", color: "var(--lavender)", category: "health", is_binary: true },
  { name: "Read", color: "var(--sand)", category: "learning", is_binary: true },
  { name: "Fajar", color: "var(--sand)", category: "spiritual", is_binary: true },
  { name: "Zohar", color: "var(--rose)", category: "spiritual", is_binary: true },
  { name: "Asar", color: "var(--rose)", category: "spiritual", is_binary: true },
  { name: "Magrib", color: "var(--violet)", category: "spiritual", is_binary: true },
  { name: "Isha", color: "var(--violet)", category: "spiritual", is_binary: true },
  { name: "Quran", color: "var(--taupe)", category: "spiritual", is_binary: true },
  { name: "Dua T&A", color: "var(--taupe)", category: "spiritual", is_binary: true },
  { name: "Less Talk", color: "var(--mint)", category: "character", is_binary: true },
  { name: "Kind Response", color: "var(--mint)", category: "character", is_binary: true },
  { name: "Control Anger", color: "var(--lilac)", category: "character", is_binary: true },
  { name: "Silent Sitting", color: "var(--lilac)", category: "mindfulness", is_binary: true },
  { name: "Journalizing", color: "var(--peach)", category: "reflection", is_binary: true }
];

export const DEFAULT_HABIT_SEED = DEFAULT_HABITS.map((habit, index) => ({
  ...habit,
  slug: habit.name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, ""),
  position: index
}));

export const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export const MOOD_OPTIONS = [
  { key: "happy", emoji: "🙂", label: "Happy" },
  { key: "confident", emoji: "😌", label: "Confident" },
  { key: "calm", emoji: "🕊️", label: "Calm" },
  { key: "angry", emoji: "😠", label: "Angry" },
  { key: "sad", emoji: "😔", label: "Sad" },
  { key: "insecure", emoji: "😟", label: "Insecure" }
];

export const QUALITY_STARS = [1, 2, 3, 4, 5];

export const DAY_RATING_STARS = [1, 2, 3, 4, 5];
