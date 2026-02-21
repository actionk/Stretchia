import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";

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
const btnSkip = document.getElementById("btn-skip")!;
const btnSettings = document.getElementById("btn-settings")!;
const btnStats = document.getElementById("btn-stats")!;
const btnClose = document.getElementById("btn-close")!;
const btnAnchor = document.getElementById("btn-anchor")!;
const historyEl = document.getElementById("history")!;
const afkBadge = document.getElementById("afk-badge")!;
const appEl = document.getElementById("app")!;
const skipDialog = document.getElementById("skip-dialog")!;
const skipMessage = document.getElementById("skip-message")!;
const skipYes = document.getElementById("skip-yes")! as HTMLButtonElement;
const skipNo = document.getElementById("skip-no")!;

const anchorChars: Record<string, string> = {
  "top-left": "\u25E4",
  "top-right": "\u25E5",
  "bottom-left": "\u25E3",
  "bottom-right": "\u25E2",
};

let compact = false;
let anchor = "top-right";
let lastElapsedS = 0;
let skipStage = 0;
let skipCountdownTimer: number | null = null;
const RED_THRESHOLD_S = 90 * 60; // 1h 30min without workout = red dot

const skipMessages = [
  "Your skeleton trusted you. Skip anyway?",
  "Your spine just filed a formal complaint. Still sure?",
  "In 20 years you'll be shaped like a question mark. Final answer?",
];

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatTimeShort(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function applyStage(stage: string) {
  timerEl.classList.remove("green", "yellow", "orange", "red");
  timerEl.classList.add(stage);
  // Background alert
  appEl.classList.remove("stage-orange", "stage-red", "stage-critical");
  if (stage === "orange") appEl.classList.add("stage-orange");
  else if (stage === "red") appEl.classList.add("stage-red");
  else if (stage === "critical") appEl.classList.add("stage-critical");
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

async function resizeAnchored(newSize: LogicalSize) {
  const win = getCurrentWindow();
  const pos = await win.outerPosition();
  const oldSize = await win.innerSize();

  await win.setSize(newSize);

  const newActualSize = await win.innerSize();
  const dx = oldSize.width - newActualSize.width;
  const dy = oldSize.height - newActualSize.height;

  let newX = pos.x;
  let newY = pos.y;
  if (anchor === "top-right" || anchor === "bottom-right") newX += dx;
  if (anchor === "bottom-left" || anchor === "bottom-right") newY += dy;

  await win.setPosition(new PhysicalPosition(newX, newY));
}

function updateAnchorIcon() {
  btnAnchor.textContent = anchorChars[anchor] || "\u25E5";
  btnAnchor.className = `anchor-${anchor}`;
  // Set corner class on app for layout-aware shifting of other buttons
  appEl.classList.remove("anchor-corner-top-left", "anchor-corner-top-right", "anchor-corner-bottom-left", "anchor-corner-bottom-right");
  appEl.classList.add(`anchor-corner-${anchor}`);
}

async function loadAnchorSetting() {
  try {
    const settings = await invoke<{ key: string; value: string }[]>("cmd_get_settings");
    for (const s of settings) {
      if (s.key === "window_anchor") {
        anchor = s.value;
        break;
      }
    }
  } catch (_) {
    // Keep default
  }
  updateAnchorIcon();
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
      const dotType = w.workout_type === "stretch" ? "stretch" : w.workout_type === "treadmill" ? "treadmill" : "skip";
      dot.classList.add(dotType);
      historyEl.appendChild(dot);
    }
  } catch (e) {
    console.error("Failed to load history:", e);
  }
}

// Listen for timer tick events from Rust
listen<TimerState>("timer-tick", (event) => {
  const state = event.payload;
  lastElapsedS = state.elapsed_s;
  timerEl.textContent = compact ? formatTimeShort(state.elapsed_s) : formatTime(state.elapsed_s);

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

  // Show skip button only during alert phases
  if (state.stage === "red" || state.stage === "critical") {
    btnSkip.classList.remove("hidden");
  } else {
    btnSkip.classList.add("hidden");
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

// Skip button — multi-stage guilt trip
function showSkipStage() {
  skipDialog.classList.remove("hidden");
  skipMessage.textContent = skipMessages[skipStage];

  if (skipStage === 2) {
    skipDialog.classList.add("stage-final");
    let countdown = 10;
    skipYes.disabled = true;
    skipYes.textContent = `Yes (${countdown})`;
    skipCountdownTimer = window.setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        clearInterval(skipCountdownTimer!);
        skipCountdownTimer = null;
        skipYes.disabled = false;
        skipYes.textContent = "Yes";
      } else {
        skipYes.textContent = `Yes (${countdown})`;
      }
    }, 1000);
  } else {
    skipDialog.classList.remove("stage-final");
    skipYes.disabled = false;
    skipYes.textContent = "Yes";
  }
}

function hideSkipDialog() {
  skipDialog.classList.add("hidden");
  skipDialog.classList.remove("stage-final");
  if (skipCountdownTimer !== null) {
    clearInterval(skipCountdownTimer);
    skipCountdownTimer = null;
  }
}

btnSkip.addEventListener("click", () => {
  skipStage = 0;
  showSkipStage();
});

skipYes.addEventListener("click", async () => {
  if (skipStage < 2) {
    skipStage++;
    showSkipStage();
  } else {
    hideSkipDialog();
    await invoke("cmd_record_skip");
    await loadHistory();
  }
});

skipNo.addEventListener("click", () => {
  hideSkipDialog();
});

// Settings button
btnSettings.addEventListener("click", async () => {
  await invoke("cmd_open_settings");
});

// Stats button
btnStats.addEventListener("click", async () => {
  await invoke("cmd_open_stats");
});

// Close/quit button with custom dialog
const quitDialog = document.getElementById("quit-dialog")!;

btnClose.addEventListener("click", () => {
  quitDialog.classList.remove("hidden");
});

document.getElementById("quit-yes")!.addEventListener("click", async () => {
  await saveWindowPosition();
  await invoke("cmd_quit");
});

document.getElementById("quit-no")!.addEventListener("click", () => {
  quitDialog.classList.add("hidden");
});

// Compact mode sizes
const NORMAL_SIZE = new LogicalSize(200, 140);
const COMPACT_SIZE = new LogicalSize(80, 28);

async function toggleCompact() {
  compact = !compact;
  appEl.classList.toggle("compact", compact);
  if (compact) {
    timerEl.textContent = formatTimeShort(lastElapsedS);
    await resizeAnchored(COMPACT_SIZE);
  } else {
    timerEl.textContent = formatTime(lastElapsedS);
    await resizeAnchored(NORMAL_SIZE);
  }
}

// Anchor button toggles compact mode
btnAnchor.addEventListener("click", () => {
  toggleCompact();
});

// Double-click to toggle compact mode
appEl.addEventListener("dblclick", async (e) => {
  if ((e.target as HTMLElement).closest("#buttons")) return;
  if ((e.target as HTMLElement).closest("#btn-settings")) return;
  if ((e.target as HTMLElement).closest("#btn-stats")) return;
  if ((e.target as HTMLElement).closest("#btn-close")) return;
  if ((e.target as HTMLElement).closest("#btn-anchor")) return;

  toggleCompact();
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

// Listen for settings changes to update anchor
listen("settings-changed", () => {
  loadAnchorSetting();
});

// Init
updateAnchorIcon();
loadAnchorSetting();
loadHistory();
