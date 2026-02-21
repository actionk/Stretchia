import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface TimerState {
  mode: string;
  elapsed_s: number;
  stage: string;
  is_afk: boolean;
  is_treadmill: boolean;
}

interface Workout {
  id: number;
  workout_type: string;
  started_at: number;
  ended_at: number;
  duration_s: number;
  sitting_before_s: number;
}

const timerEl = document.getElementById("timer")!;
const btnStretch = document.getElementById("btn-stretch")!;
const btnTreadmill = document.getElementById("btn-treadmill")!;
const btnSettings = document.getElementById("btn-settings")!;
const historyEl = document.getElementById("history")!;
const afkBadge = document.getElementById("afk-badge")!;
const appEl = document.getElementById("app")!;

let compact = false;
const RED_THRESHOLD_S = 90 * 60; // 1h 30min without workout = red dot

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function applyStage(stage: string) {
  timerEl.classList.remove("green", "yellow", "orange", "red");
  timerEl.classList.add(stage);
}

function flashApp(color: "green" | "blue") {
  appEl.classList.remove("flash-green", "flash-blue");
  void appEl.offsetWidth;
  appEl.classList.add(`flash-${color}`);
  setTimeout(() => appEl.classList.remove(`flash-${color}`), 700);
}

function triggerShake() {
  appEl.classList.remove("shake");
  void appEl.offsetWidth;
  appEl.classList.add("shake");
  setTimeout(() => appEl.classList.remove("shake"), 600);
}

async function loadHistory() {
  try {
    const workouts = await invoke<Workout[]>("cmd_get_today_history");
    historyEl.innerHTML = "";

    // Only show dots for actual workouts + red dots for long sitting streaks
    for (const w of workouts) {
      // If sat for 90+ min before this workout, add a red dot first
      if (w.sitting_before_s >= RED_THRESHOLD_S) {
        const redDot = document.createElement("div");
        redDot.className = "dot overdue";
        historyEl.appendChild(redDot);
      }
      const dot = document.createElement("div");
      dot.className = "dot";
      dot.classList.add(w.workout_type === "stretch" ? "stretch" : "treadmill");
      historyEl.appendChild(dot);
    }
  } catch (e) {
    console.error("Failed to load history:", e);
  }
}

// Listen for timer tick events from Rust
listen<TimerState>("timer-tick", (event) => {
  const state = event.payload;
  timerEl.textContent = formatTime(state.elapsed_s);

  if (state.is_treadmill) {
    timerEl.classList.remove("green", "yellow", "orange", "red");
    timerEl.style.color = "#60a5fa";
    btnTreadmill.textContent = "Stop";
    btnTreadmill.classList.add("active");
  } else {
    timerEl.style.color = "";
    applyStage(state.stage);
    btnTreadmill.textContent = "Treadmill";
    btnTreadmill.classList.remove("active");
  }

  if (state.is_afk) {
    afkBadge.classList.remove("hidden");
  } else {
    afkBadge.classList.add("hidden");
  }

  // Shake at critical stage every 5 minutes
  if (state.stage === "critical") {
    if (state.elapsed_s > 0 && state.elapsed_s % 300 === 0) {
      triggerShake();
    }
  }
});

// Stretch button
btnStretch.addEventListener("click", async () => {
  await invoke("cmd_record_stretch");
  flashApp("green");
  await loadHistory();
});

// Treadmill button
btnTreadmill.addEventListener("click", async () => {
  const isTreadmill = btnTreadmill.classList.contains("active");
  if (isTreadmill) {
    await invoke("cmd_stop_treadmill");
    flashApp("blue");
    await loadHistory();
  } else {
    await invoke("cmd_start_treadmill");
  }
});

// Settings button
btnSettings.addEventListener("click", async () => {
  await invoke("cmd_open_settings");
});

// Double-click to toggle compact mode
appEl.addEventListener("dblclick", (e) => {
  if ((e.target as HTMLElement).closest("#buttons")) return;
  if ((e.target as HTMLElement).closest("#btn-settings")) return;
  compact = !compact;
  appEl.classList.toggle("compact", compact);
});

// Save window position helper
async function saveWindowPosition() {
  try {
    const win = getCurrentWindow();
    const pos = await win.outerPosition();
    await invoke("cmd_save_window_position", { x: pos.x, y: pos.y });
  } catch (_) {
    // Best effort
  }
}

// Save position whenever the window is moved
getCurrentWindow().onMoved(() => {
  saveWindowPosition();
});

// Close to tray instead of quitting, save position first
getCurrentWindow().onCloseRequested(async (event) => {
  event.preventDefault();
  await saveWindowPosition();
  await getCurrentWindow().hide();
});

// Init
loadHistory();
