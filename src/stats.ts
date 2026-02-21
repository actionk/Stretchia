import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Workout {
  id: number;
  workout_type: string;
  started_at: number;
  ended_at: number;
  duration_s: number;
  sitting_before_s: number;
}

interface DayStats {
  date: string;
  stretch_count: number;
  treadmill_count: number;
  treadmill_total_s: number;
  active_s: number;
  afk_s: number;
  avg_sitting_before_s: number;
  max_sitting_before_s: number;
  workouts: Workout[];
}

const dateLabel = document.getElementById("date-label")!;
const btnPrev = document.getElementById("btn-prev") as HTMLButtonElement;
const btnNext = document.getElementById("btn-next") as HTMLButtonElement;
const stretchCount = document.getElementById("stretch-count")!;
const treadmillCount = document.getElementById("treadmill-count")!;
const treadmillTime = document.getElementById("treadmill-time")!;
const activeTime = document.getElementById("active-time")!;
const avgSitting = document.getElementById("avg-sitting")!;
const maxSitting = document.getElementById("max-sitting")!;
const afkTime = document.getElementById("afk-time")!;
const timeline = document.getElementById("timeline")!;
const emptyState = document.getElementById("empty-state")!;

let currentDate = new Date();

function formatDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateDisplay(d: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (formatDateISO(d) === formatDateISO(today)) return "Today";
  if (formatDateISO(d) === formatDateISO(yesterday)) return "Yesterday";

  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatTime24(unixTs: number): string {
  const d = new Date(unixTs * 1000);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function updateNav() {
  const today = formatDateISO(new Date());
  const current = formatDateISO(currentDate);
  btnNext.disabled = current >= today;
  dateLabel.textContent = formatDateDisplay(currentDate);
}

async function loadStats() {
  updateNav();
  const dateStr = formatDateISO(currentDate);

  try {
    const stats = await invoke<DayStats>("cmd_get_day_stats", { date: dateStr });

    stretchCount.textContent = String(stats.stretch_count);
    treadmillCount.textContent = String(stats.treadmill_count);
    treadmillTime.textContent = formatDuration(stats.treadmill_total_s);
    activeTime.textContent = formatDuration(stats.active_s);
    avgSitting.textContent = stats.avg_sitting_before_s > 0
      ? formatDuration(Math.round(stats.avg_sitting_before_s))
      : "—";
    maxSitting.textContent = stats.max_sitting_before_s > 0
      ? formatDuration(stats.max_sitting_before_s)
      : "—";
    afkTime.textContent = stats.afk_s > 0 ? formatDuration(stats.afk_s) : "—";

    // Timeline
    timeline.innerHTML = "";
    if (stats.workouts.length === 0) {
      emptyState.classList.remove("hidden");
      timeline.classList.add("hidden");
    } else {
      emptyState.classList.add("hidden");
      timeline.classList.remove("hidden");

      for (const w of stats.workouts) {
        const entry = document.createElement("div");
        entry.className = "tl-entry";

        const time = document.createElement("span");
        time.className = "tl-time";
        time.textContent = formatTime24(w.started_at);

        const dot = document.createElement("span");
        dot.className = `tl-dot ${w.workout_type}`;

        const desc = document.createElement("span");
        desc.className = "tl-desc";
        if (w.workout_type === "stretch") {
          desc.textContent = "Stretch break";
        } else {
          desc.textContent = `Treadmill — ${formatDuration(w.duration_s)}`;
        }

        const sitting = document.createElement("span");
        sitting.className = "tl-sitting";
        sitting.textContent = `after ${formatDuration(w.sitting_before_s)}`;

        const del = document.createElement("button");
        del.className = "tl-delete";
        del.textContent = "\u00d7";
        del.title = "Delete";
        del.addEventListener("click", async () => {
          await invoke("cmd_delete_workout", { id: w.id });
          loadStats();
        });

        entry.appendChild(time);
        entry.appendChild(dot);
        entry.appendChild(desc);
        entry.appendChild(sitting);
        entry.appendChild(del);
        timeline.appendChild(entry);
      }
    }
  } catch (e) {
    console.error("Failed to load stats:", e);
  }
}

btnPrev.addEventListener("click", () => {
  currentDate.setDate(currentDate.getDate() - 1);
  loadStats();
});

btnNext.addEventListener("click", () => {
  const today = formatDateISO(new Date());
  const next = new Date(currentDate);
  next.setDate(next.getDate() + 1);
  if (formatDateISO(next) <= today) {
    currentDate = next;
    loadStats();
  }
});

// Hide instead of destroy
getCurrentWindow().onCloseRequested(async (event) => {
  event.preventDefault();
  getCurrentWindow().hide();
});

// Reload when window gains focus
getCurrentWindow().onFocusChanged(({ payload: focused }) => {
  if (focused) {
    currentDate = new Date();
    loadStats();
  }
});

loadStats();
