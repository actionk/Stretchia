# StretchReminder

## Project Info
- **Framework:** Tauri 2.x (Rust backend + HTML/CSS/TS frontend)
- **Purpose:** Desktop app that reminds users to stretch/exercise with escalating visual cues
- **Platforms:** Windows + macOS
- **Database:** SQLite via rusqlite (bundled)

## Commands
- `npm run tauri dev` — Run in development mode (Vite + Tauri)
- `npm run tauri build` — Build production binary
- `npm run dev` — Start Vite dev server only (frontend)
- `npm run build` — Build frontend only (tsc + vite build)

## Project Structure
```
src/                    # Frontend (HTML + CSS + TypeScript)
  index.html            # Main window markup
  styles.css            # Styling, animations, color stages
  main.ts               # Frontend logic, Tauri API calls, event listeners
src-tauri/              # Rust backend
  src/
    main.rs             # Entry point
    lib.rs              # Tauri commands, AppState, setup, tick loop
    db.rs               # SQLite operations (workouts, settings, computer_usage)
    timer.rs            # TimerState, stages (Green/Yellow/Orange/Red/Critical)
    afk.rs              # AFK detection (GetLastInputInfo on Windows, ioreg on macOS)
    tray.rs             # System tray icon + menu
  Cargo.toml            # Rust dependencies
  tauri.conf.json       # Window config (transparent, frameless, always-on-top, 200x140)
  capabilities/         # Tauri permission capabilities
```

## Architecture
- **Timer tick loop:** Background Rust thread emits `timer-tick` events every second
- **AFK detection:** Checks OS idle time; pauses timer when idle > threshold (default 5 min)
- **Tray icon:** Dynamic 16x16 RGBA circle, color matches timer stage
- **Window:** Frameless, transparent, always-on-top, draggable via `data-tauri-drag-region`
- **State:** `Mutex<AppState>` managed by Tauri, contains timer + SQLite connection

## Timer Stages
| Time      | Stage    | Color  | Effect          |
|-----------|----------|--------|-----------------|
| 0-30 min  | Green    | #4ade80| None            |
| 30-45 min | Yellow   | #facc15| None            |
| 45-60 min | Orange   | #fb923c| Gentle pulsing  |
| 60-75 min | Red      | #ef4444| Strong pulsing  |
| 75+ min   | Critical | #ef4444| CSS shake/5 min |

## Database
- Location: `%APPDATA%/StretchReminder/data.db` (Windows)
- Tables: `workouts`, `computer_usage`, `settings`
