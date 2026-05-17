# MeTrack: Habit Builder

MeTrack aik personal daily routine aur reflection tracker hai jo printed thermal tracker ke clean, soft aur minimal visual language se inspired hai. Is repo mein web app React mein hai, Android shell ke liye Capacitor ready hai, backend Supabase ke liye structured hai, aur external agents ke liye secure MCP server bhi included hai.

## Stack

- React 18
- Vite
- Supabase Auth + Database
- Capacitor Android
- Node-based MCP server
- Supabase Edge Functions for MCP gateway/security

## Project structure

- `src/App.jsx` - Main tracker UI
- `src/SecurityMount.jsx` - Signed-in security center mount
- `src/SecurityPanel.jsx` - MCP token, scope, expiry, audit and security event UI
- `src/securityApi.js` - Frontend security API helpers
- `src/api.js` - Frontend data layer
- `src/supabase.js` - Supabase client setup
- `styles.css` and `src/security.css` - App styling
- `capacitor.config.ts` - Android shell config
- `supabase/schema.sql` - Full backend schema + RLS
- `supabase/migrations/20260517_mcp_security_hardening.sql` - MCP security hardening migration
- `supabase/functions/mcp-gateway/index.ts` - Core MCP gateway
- `supabase/functions/mcp-gateway-secure/index.ts` - Secure proxy gateway with rate limits and security events
- `mcp-server/index.js` - External-agent MCP server
- `.env.example` - Frontend env template

## Setup

```bash
npm install
cp .env.example .env
```

`.env` mein ye values daalni hongi:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
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
3. `supabase/migrations/20260517_mcp_security_hardening.sql` apply karein agar schema already deployed hai
4. Frontend `.env` values set karein
5. Edge Functions deploy karein:

```bash
supabase functions deploy mcp-gateway --no-verify-jwt
supabase functions deploy mcp-gateway-secure --no-verify-jwt
```

Is schema mein signup ke baad default habits backend level par auto-seed ho jati hain.

Security hardening ke liye is mein yeh add hai:

- `mcp_api_tokens` for password-free MCP access
- `can_read`, `can_write`, `can_analyze` scopes
- token expiry selector support
- `mcp_audit_logs` for MCP action trail
- `mcp_security_events` for rate-limit, failed-auth, blocked and suspicious activity events
- `mcp_audit_log_view` for readable audit panel
- stronger input constraints and indexes

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
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY \
npm run mcp
```

By default MCP server secure gateway use karta hai:

```bash
https://YOUR_PROJECT_REF.supabase.co/functions/v1/mcp-gateway-secure
```

Agar kabhi explicitly override karna ho:

```bash
MCP_GATEWAY_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/mcp-gateway-secure
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

## Secure MCP flow

1. User app ke signed-in area mein `MCP Security Center` open kare
2. Token label, expiry aur scopes choose kare
3. Token generate kare aur one-time token copy kare
4. Agent `authenticate_with_token` tool se connect ho
5. MCP server secure gateway ko call kare
6. Secure gateway token validate karta hai, scope check karta hai, rate limit enforce karta hai, suspicious activity block karta hai
7. Core gateway action perform karta hai
8. Audit logs aur security events app ke Security Center mein visible hote hain

### Current security limits

- 60 requests/minute per token
- 120 requests/minute per IP
- 20 successful writes/minute per token/action
- 30 successful analytics calls/minute per token/action
- 8 failed/blocked attempts within 10 minutes from same IP triggers suspicious guard

Yeh structure is liye rakha gaya hai taake user kisi bhi LLM ya agent ko MCP attach karke tracker ko natural language mein update karwa sake, bina account password share kiye aur without unlimited access.
