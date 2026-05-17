# MeTrack: Habit Builder

MeTrack aik personal daily routine aur reflection tracker hai jo printed thermal tracker ke clean, soft aur minimal visual language se inspired hai. Is repo mein web app React mein hai, Android shell ke liye Capacitor ready hai, backend Supabase ke liye structured hai, aur external agents ke liye MCP server bhi included hai.

## Stack

- React 18
- Vite
- Supabase Auth + Database
- Capacitor Android
- Node-based MCP server

## Project structure

- `src/App.jsx`
  Main tracker UI
- `src/api.js`
  Frontend data layer
- `src/supabase.js`
  Supabase client setup
- `styles.css`
  App styling
- `supabase/schema.sql`
  Full backend schema + RLS
- `mcp-server/index.js`
  External-agent MCP server
- `.env.example`
  Frontend env template

## Setup

```bash
npm install
cp .env.example .env
```

`.env` mein ye values daalni hongi:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

## Web app run

```bash
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

## Supabase backend

1. Email/password auth enable karein
2. `supabase/schema.sql` project database par run karein
3. Frontend `.env` values set karein

Is schema mein signup ke baad default habits backend level par auto-seed ho jati hain.

## Android app

```bash
npx cap add android
npm run build
npm run android:sync
npm run android:open
```

`capacitor.config.json` already `dist` build output ke liye configured hai.

## MCP server

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co \
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY \
npm run mcp
```

### Available tools

- `sign_in`
- `sign_out`
- `who_am_i`
- `get_today_dashboard`
- `mark_habits`
- `update_reflection`
- `set_sleep`
- `set_mood`
- `weekly_summary`
- `habit_consistency_report`
- `reflection_pattern_report`
- `missed_habits_report`
- `top_struggles_report`
- `recommended_focus_for_tomorrow`

Yeh structure is liye rakha gaya hai taake user kisi bhi LLM ya agent ko MCP attach karke tracker ko natural language mein update karwa sake.
