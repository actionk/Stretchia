use rusqlite::{Connection, params};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize, Clone)]
pub struct Workout {
    pub id: i64,
    pub workout_type: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_s: i64,
    pub sitting_before_s: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct Setting {
    pub key: String,
    pub value: String,
}

pub fn db_path() -> PathBuf {
    let base = if cfg!(target_os = "windows") {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| dirs_fallback())
    } else {
        dirs_fallback()
    };
    base.join("StretchReminder")
}

fn dirs_fallback() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
}

pub fn initialize() -> rusqlite::Result<Connection> {
    let dir = db_path();
    std::fs::create_dir_all(&dir).ok();
    let db_file = dir.join("data.db");
    let conn = Connection::open(db_file)?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS workouts (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            type             TEXT NOT NULL,
            started_at       INTEGER NOT NULL,
            ended_at         INTEGER NOT NULL,
            duration_s       INTEGER NOT NULL,
            sitting_before_s INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS computer_usage (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            date     TEXT NOT NULL UNIQUE,
            active_s INTEGER NOT NULL DEFAULT 0,
            afk_s    INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );"
    )?;

    // Seed defaults if not present
    let defaults = [
        ("afk_threshold_min", "5"),
        ("warn_at_min", "45"),
        ("shake_at_min", "75"),
        ("window_opacity", "0.8"),
        ("history_dots_count", "10"),
    ];
    for (k, v) in defaults {
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
            params![k, v],
        )?;
    }

    Ok(conn)
}

pub fn record_stretch(conn: &Connection, sitting_before_s: i64) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO workouts (type, started_at, ended_at, duration_s, sitting_before_s)
         VALUES ('stretch', ?1, ?2, 300, ?3)",
        params![now, now + 300, sitting_before_s],
    )?;
    Ok(())
}

pub fn record_treadmill(conn: &Connection, started_at: i64, duration_s: i64, sitting_before_s: i64) -> rusqlite::Result<()> {
    let ended_at = started_at + duration_s;
    conn.execute(
        "INSERT INTO workouts (type, started_at, ended_at, duration_s, sitting_before_s)
         VALUES ('treadmill', ?1, ?2, ?3, ?4)",
        params![started_at, ended_at, duration_s, sitting_before_s],
    )?;
    Ok(())
}

pub fn get_today_workouts(conn: &Connection) -> rusqlite::Result<Vec<Workout>> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut stmt = conn.prepare(
        "SELECT id, type, started_at, ended_at, duration_s, sitting_before_s
         FROM workouts
         WHERE date(started_at, 'unixepoch', 'localtime') = ?1
         ORDER BY started_at"
    )?;
    let rows = stmt.query_map(params![today], |row| {
        Ok(Workout {
            id: row.get(0)?,
            workout_type: row.get(1)?,
            started_at: row.get(2)?,
            ended_at: row.get(3)?,
            duration_s: row.get(4)?,
            sitting_before_s: row.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn update_computer_usage(conn: &Connection, active_delta: i64, afk_delta: i64) -> rusqlite::Result<()> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    conn.execute(
        "INSERT INTO computer_usage (date, active_s, afk_s) VALUES (?1, ?2, ?3)
         ON CONFLICT(date) DO UPDATE SET active_s = active_s + ?2, afk_s = afk_s + ?3",
        params![today, active_delta, afk_delta],
    )?;
    Ok(())
}

pub fn load_settings(conn: &Connection) -> rusqlite::Result<Vec<Setting>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| {
        Ok(Setting {
            key: row.get(0)?,
            value: row.get(1)?,
        })
    })?;
    rows.collect()
}

pub fn update_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    )?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    ).ok()
}
