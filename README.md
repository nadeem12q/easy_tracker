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
- `capacitor.config.ts`
  Android shell config
- `public/manifest.webmanifest`
  Installable web app metadata
- `resources/android/*`
  Android icon and splash source assets
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

## App open behavior

- App open hote hi user ko clean preview milta hai
- Account create karna force nahin hota
- First open par onboarding panel batata hai ke preview mode aur account mode mein kya farq hai
- Login/signup karne ke baad data personal account ke saath save hota hai
- New account par default habits backend level par automatically create ho jati hain

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
Security hardening ke liye is mein yeh bhi add hai:

- `mcp_api_tokens` for password-free MCP access
- `mcp_audit_logs` for MCP action trail
- stronger input constraints and length checks
- extra indexes for user-scoped access paths

## Android app

```bash
npm run android:init
npm run build
npm run android:build
npm run android:open
```

Android side par yeh cheezen ready hain:

- `capacitor.config.ts` production-style config
- app id aur app name set
- splash, status bar, keyboard plugin config
- PWA manifest aur favicon
- Android icon/splash source SVG assets

Capacitor assets generate karne ke liye aap apni machine par baad mein `@capacitor/assets` ya Android Studio based asset workflow use kar sakte hain.

## MCP server

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co \
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY \
npm run mcp
```

Optional:

```bash
MCP_GATEWAY_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/mcp-gateway
```

### Available tools

- `authenticate_with_token`
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
- `capture_day_update`
- `daily_gap_analysis`
- `streak_risk_report`
- `momentum_report`
- `coaching_brief`

MCP ka secure flow ab yeh hai:

1. User app ke signed-in area se MCP token generate kare
2. Agent `authenticate_with_token` tool se connect ho
3. MCP server token ko Supabase Edge Function gateway ke through verify kare
4. Har action audit log mein record ho

Yeh structure is liye rakha gaya hai taake user kisi bhi LLM ya agent ko MCP attach karke tracker ko natural language mein update karwa sake, bina account password share kiye.
