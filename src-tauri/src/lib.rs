mod afk;
mod db;
mod timer;
mod tray;

use std::sync::Mutex;
use rusqlite::Connection;
use tauri::{Emitter, Listener, Manager};
use timer::{Mode, TimerState, TimerTickPayload};

pub struct AppState {
    pub timer: TimerState,
    pub db: Connection,
    last_stage: Option<timer::Stage>,
}

fn open_settings_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.show();
        let _ = w.center();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn cmd_get_timer_state(state: tauri::State<'_, Mutex<AppState>>) -> Result<TimerTickPayload, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let stage = s.timer.calculate_stage();
    Ok(TimerTickPayload {
        mode: format!("{:?}", s.timer.mode),
        elapsed_s: s.timer.elapsed_s,
        stage: stage.as_str().to_string(),
        is_afk: s.timer.is_afk,
        is_treadmill: s.timer.mode == Mode::Treadmill,
    })
}

#[tauri::command]
fn cmd_record_stretch(state: tauri::State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let sitting_before = s.timer.elapsed_s as i64;
    db::record_stretch(&s.db, sitting_before).map_err(|e| e.to_string())?;
    s.timer.reset();
    Ok(())
}

#[tauri::command]
fn cmd_start_treadmill(state: tauri::State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.timer.start_treadmill();
    Ok(())
}

#[tauri::command]
fn cmd_stop_treadmill(state: tauri::State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let (started, duration, sitting_before) = s.timer.stop_treadmill();
    db::record_treadmill(&s.db, started, duration as i64, sitting_before as i64)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn cmd_get_today_history(state: tauri::State<'_, Mutex<AppState>>) -> Result<Vec<db::Workout>, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    db::get_today_workouts(&s.db).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_get_settings(state: tauri::State<'_, Mutex<AppState>>) -> Result<Vec<db::Setting>, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    db::load_settings(&s.db).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_update_setting(state: tauri::State<'_, Mutex<AppState>>, key: String, value: String) -> Result<(), String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    db::update_setting(&s.db, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_open_settings(app: tauri::AppHandle) -> Result<(), String> {
    open_settings_window(&app);
    Ok(())
}

#[tauri::command]
fn cmd_apply_settings(state: tauri::State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let afk_threshold = db::get_setting(&s.db, "afk_threshold_min")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(5)
        * 60;
    s.timer.afk_threshold_s = afk_threshold;
    Ok(())
}

#[tauri::command]
fn cmd_save_window_position(state: tauri::State<'_, Mutex<AppState>>, x: i32, y: i32) -> Result<(), String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    db::update_setting(&s.db, "window_x", &x.to_string()).map_err(|e| e.to_string())?;
    db::update_setting(&s.db, "window_y", &y.to_string()).map_err(|e| e.to_string())?;
    Ok(())
}

fn restore_window_position(app: &tauri::AppHandle, db: &Connection) {
    let x = db::get_setting(db, "window_x");
    let y = db::get_setting(db, "window_y");
    if let (Some(x_str), Some(y_str)) = (x, y) {
        if let (Ok(x), Ok(y)) = (x_str.parse::<i32>(), y_str.parse::<i32>()) {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
            }
        }
    }
}

fn start_tick_loop(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));

            let state = app.state::<Mutex<AppState>>();
            let mut s = match state.lock() {
                Ok(s) => s,
                Err(_) => continue,
            };

            // Check AFK
            let idle = afk::get_idle_seconds();
            let was_afk = s.timer.is_afk;
            s.timer.is_afk = idle >= s.timer.afk_threshold_s;

            if s.timer.is_afk {
                let _ = db::update_computer_usage(&s.db, 0, 1);
            } else {
                s.timer.elapsed_s += 1;
                let _ = db::update_computer_usage(&s.db, 1, 0);
            }

            // Update tray icon on stage change
            let stage = s.timer.calculate_stage();
            let stage_changed = s.last_stage.as_ref() != Some(&stage);
            if stage_changed || was_afk != s.timer.is_afk {
                s.last_stage = Some(stage.clone());
                tray::update_tray_icon(app.app_handle(), &stage);
            }

            let payload = TimerTickPayload {
                mode: format!("{:?}", s.timer.mode),
                elapsed_s: s.timer.elapsed_s,
                stage: stage.as_str().to_string(),
                is_afk: s.timer.is_afk,
                is_treadmill: s.timer.mode == Mode::Treadmill,
            };

            drop(s);
            let _ = app.emit("timer-tick", payload);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = db::initialize().expect("Failed to initialize database");

    let afk_threshold = db::get_setting(&conn, "afk_threshold_min")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(5)
        * 60;

    let mut timer_state = TimerState::new();
    timer_state.afk_threshold_s = afk_threshold;

    let app_state = AppState {
        timer: timer_state,
        db: conn,
        last_stage: None,
    };

    tauri::Builder::default()
        .manage(Mutex::new(app_state))
        .invoke_handler(tauri::generate_handler![
            cmd_get_timer_state,
            cmd_record_stretch,
            cmd_start_treadmill,
            cmd_stop_treadmill,
            cmd_get_today_history,
            cmd_get_settings,
            cmd_update_setting,
            cmd_save_window_position,
            cmd_open_settings,
            cmd_apply_settings,
        ])
        .setup(|app| {
            tray::create_tray(app.handle())?;

            // Restore window position
            {
                let state = app.state::<Mutex<AppState>>();
                let s = state.lock().unwrap();
                restore_window_position(app.handle(), &s.db);
            }

            // Handle tray "Stretch Now" event
            let handle = app.handle().clone();
            app.listen("tray-stretch", move |_| {
                let state = handle.state::<Mutex<AppState>>();
                let mut s = match state.lock() {
                    Ok(s) => s,
                    Err(_) => return,
                };
                let sitting_before = s.timer.elapsed_s as i64;
                let _ = db::record_stretch(&s.db, sitting_before);
                s.timer.reset();
            });

            // Handle tray "Settings" event
            let handle2 = app.handle().clone();
            app.listen("tray-settings", move |_| {
                open_settings_window(&handle2);
            });

            // Start the timer tick loop
            start_tick_loop(app.handle().clone());

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
