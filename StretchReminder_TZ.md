# Spec: Stretch Reminder — Desktop Workout Tracker

## 1. Overview

A small cross-platform desktop application (Windows + macOS) that:
- Displays a timer showing time elapsed since the last workout/stretch
- Visually escalates attention-grabbing as the timer grows
- Records stretch breaks and treadmill sessions
- Stores full history in a local SQLite database
- Tracks total active computer time (excluding AFK periods)

---

## 2. Tech Stack

| Component | Technology |
|---|---|
| Framework | Tauri 2.x |
| Backend | Rust |
| Frontend | HTML + CSS + TypeScript (no frameworks) |
| Database | SQLite (via `rusqlite`) |
| Packaging | Tauri bundler (`.exe`, `.dmg`) |

---

## 3. UI

### 3.1 Main Window

- **Size:** ~180×120 px, fixed, non-resizable
- **Position:** remembered between sessions; default — bottom-right corner
- **Behavior:**
  - Always on top of other windows
  - Semi-transparent (opacity ~70–80%)
  - Frameless (no standard title bar or border)
  - Draggable by clicking anywhere on the window
  - Double-click — collapses to compact mode (timer only)

### 3.2 UI Elements

```
┌─────────────────────────┐
│   ⏱ 00:47:23            │
│   [Stretch]  [🚶 Treadmill] │
│   ● ● ● ○ ○            │
└─────────────────────────┘
```

- **Timer** — large, centered. Format `HH:MM:SS`
- **"Stretch" button** — resets timer + records a stretch workout
- **"Treadmill" button** — toggles treadmill mode on/off
- **Dot row** — history of the last N activities for the day:
  - 🟢 Green — stretch/exercise break
  - 🔵 Blue — treadmill session
  - ⚪ Gray — empty slot

---

## 4. Timer Logic

### 4.1 Standard Mode

The timer counts time since the last activity (stretch, treadmill, or app start).

**Visual stages over time:**

| Time | Timer Color | Effect |
|---|---|---|
| 0–30 min | Green | None |
| 30–45 min | Yellow | None |
| 45–60 min | Orange | Gentle pulsing |
| 60–75 min | Red | Strong pulsing |
| 75+ min | Red | Window shake every 5 minutes |

Shake: the window rapidly shifts ±5px several times (~0.5s animation).

### 4.2 "Stretch" Button

1. Save record to DB: type `stretch`, timestamp, sitting time before
2. Reset timer to `00:00:00`
3. Add green dot to history row
4. Window briefly flashes green (confirmation animation)

### 4.3 Treadmill Mode

**Activation (press "Treadmill"):**
1. Record treadmill start time
2. Reset the main timer
3. Timer shows walking duration, color — blue
4. Button switches to "Stop" state (different style)

**Deactivation (press again):**
1. Save record to DB: type `treadmill`, start time, walking duration
2. Reset timer (begin new sitting countdown)
3. Add blue dot to history row
4. Window briefly flashes blue

---

## 5. AFK Detection

**Logic:**
- Every 30 seconds the Rust backend checks time since last input (mouse + keyboard)
- If no input for **more than 5 minutes** → AFK mode:
  - Main timer is **paused**
  - UI indicator shows "AFK"
  - This period is **not counted** as sitting or activity time
- On return (any input) → timer resumes

**Platform APIs:**
- Windows: `GetLastInputInfo` (Win32 API)
- macOS: `CGEventSource.secondsSinceLastEventType`

**Setting:** AFK threshold (default 5 min) — configurable in app settings.

---

## 6. Database (SQLite)

### Table `workouts`

A single table for all activities — stretches and treadmill sessions.

```sql
CREATE TABLE workouts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    type             TEXT NOT NULL,    -- 'stretch' | 'treadmill'
    started_at       INTEGER NOT NULL, -- unix timestamp when activity started
    ended_at         INTEGER NOT NULL, -- unix timestamp when activity ended
    duration_s       INTEGER NOT NULL, -- activity duration in seconds
                                       -- for 'stretch' always 300 (5 min), not measured
    sitting_before_s INTEGER NOT NULL  -- active sitting time before this activity
);
```

**Notes:**
- `type = 'stretch'` — `duration_s` is fixed at 300 (5 min), exact duration is not tracked
- `type = 'treadmill'` — `duration_s` is measured from start to stop press
- `sitting_before_s` — enables statistics like "how often did I take breaks" and "longest sitting streak"

**Example queries for future statistics:**
```sql
-- All workouts today
SELECT * FROM workouts WHERE date(started_at, 'unixepoch') = date('now') ORDER BY started_at;

-- Total treadmill time this week
SELECT SUM(duration_s) FROM workouts
WHERE type = 'treadmill' AND started_at >= strftime('%s', 'now', '-7 days');

-- Average sitting time between stretch breaks
SELECT AVG(sitting_before_s) FROM workouts WHERE type = 'stretch';
```

### Table `computer_usage`
```sql
CREATE TABLE computer_usage (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL,       -- 'YYYY-MM-DD'
    active_s   INTEGER NOT NULL,    -- active time for the day (excluding AFK)
    afk_s      INTEGER NOT NULL     -- AFK time for the day
);
```

### Table `settings`
```sql
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

DB path: `%APPDATA%/StretchReminder/data.db` (Win) / `~/Library/Application Support/StretchReminder/data.db` (Mac)

---

## 7. App Settings

Minimum set (stored in the `settings` table):

| Key | Default | Description |
|---|---|---|
| `afk_threshold_min` | `5` | AFK threshold in minutes |
| `warn_at_min` | `45` | When to start warning |
| `shake_at_min` | `75` | When to start shaking the window |
| `window_x` | auto | Window X position |
| `window_y` | auto | Window Y position |
| `window_opacity` | `0.8` | Opacity (0.5–1.0) |
| `history_dots_count` | `10` | Number of dots to show |

---

## 8. System Tray

- App minimizes to tray (does not close)
- Tray icon changes color based on current timer stage
- Tray context menu:
  - Show window
  - Stretch (quick reset without opening the window)
  - Quit

---

## 9. Project Structure (Tauri)

```
stretch-reminder/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs          # Entry point, Tauri setup
│   │   ├── timer.rs         # Timer logic
│   │   ├── afk.rs           # AFK detection (platform-specific)
│   │   ├── db.rs            # SQLite operations
│   │   └── tray.rs          # System tray
│   └── Cargo.toml
├── src/
│   ├── index.html
│   ├── main.ts              # Frontend logic
│   └── styles.css
└── tauri.conf.json
```

---

## 10. Development Milestones

| Stage | Contents | Estimate |
|---|---|---|
| 1 | Basic Tauri window: transparency, always-on-top, drag | 2–3 days |
| 2 | Timer + visual stages (color, pulsing) | 2–3 days |
| 3 | Stretch/treadmill buttons + history dots | 2–3 days |
| 4 | SQLite: schema, writing sessions | 1–2 days |
| 5 | AFK detection (Win + Mac) | 3–4 days |
| 6 | System tray | 1–2 days |
| 7 | Settings | 1–2 days |
| 8 | Window shake + confirmation animations | 1 day |
| 9 | Build and test on both platforms | 2–3 days |

**Total:** ~3 weeks with active development

---

## 11. Out of Scope (Future Versions)

- Statistics / charts
- OS notifications
- Sound reminders
- Sync / cloud
- Mobile app
