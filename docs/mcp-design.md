# MeTrack MCP Design

## Goal

MCP server ka maqsad ye hai ke user kisi bhi LLM ya agent ko bole:

- aaj fajar aur workout done mark kar do
- mood happy tha aur day rating 4 kar do
- gratitude mein family, health aur rizq likh do
- kal ke liye focus deep work rakh do
- pichle haftay ka pattern analyze karke batao

Aur agent woh sab MeTrack account mein direct save kar sake.

## Recommended standard

### Authentication model

- Agent pehle `sign_in(email, password)` tool use kare.
- Server Supabase Auth se user session hasil kare.
- Us session ke bearer token ke saath saari CRUD operations kare.
- Is approach ka faida ye hai ke service-role secret agent ko dena nahin padta.

### Core tool groups

1. Session tools
   - `sign_in`
   - `sign_out`
   - `who_am_i`
2. Daily tracker tools
   - `get_today_dashboard`
   - `mark_habits`
   - `set_sleep`
   - `set_mood`
   - `update_reflection`
3. Insight tools
   - `weekly_summary`
   - `habit_consistency_report`
   - `reflection_pattern_report`

## Why this shape practical hai

- App clean rehti hai, kyun ke LLM workflow app ke andar hardcode nahin hota.
- User kisi bhi model ke saath apna MCP server use kar sakta hai.
- Supabase RLS user-level data isolation ko enforce karti hai.
- Future mein isi server par analytics aur streak tools asani se add honge.

## Next recommended upgrade

Production phase mein `sign_in(email,password)` ke ilawa ye do cheezen useful hongi:

1. App-generated personal access tokens
2. Dedicated edge functions for summary + analysis endpoints
