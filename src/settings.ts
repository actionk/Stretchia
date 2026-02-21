import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Setting {
  key: string;
  value: string;
}

const fields: Record<string, HTMLInputElement> = {
  afk_threshold_min: document.getElementById("afk_threshold_min") as HTMLInputElement,
  warn_at_min: document.getElementById("warn_at_min") as HTMLInputElement,
  shake_at_min: document.getElementById("shake_at_min") as HTMLInputElement,
  window_opacity: document.getElementById("window_opacity") as HTMLInputElement,
  history_dots_count: document.getElementById("history_dots_count") as HTMLInputElement,
};

const opacityDisplay = document.getElementById("opacity-display")!;
const statusEl = document.getElementById("status")!;

fields.window_opacity.addEventListener("input", () => {
  opacityDisplay.textContent = parseFloat(fields.window_opacity.value).toFixed(2);
});

async function loadSettings() {
  try {
    const settings = await invoke<Setting[]>("cmd_get_settings");
    for (const s of settings) {
      if (fields[s.key]) {
        fields[s.key].value = s.value;
      }
    }
    opacityDisplay.textContent = parseFloat(fields.window_opacity.value).toFixed(2);
  } catch (e) {
    showStatus("Failed to load settings", true);
  }
}

function showStatus(msg: string, isError: boolean) {
  statusEl.textContent = msg;
  statusEl.className = isError ? "error" : "success";
  setTimeout(() => {
    statusEl.className = "hidden";
  }, 2000);
}

function hideWindow() {
  getCurrentWindow().hide();
}

document.getElementById("btn-save")!.addEventListener("click", async () => {
  try {
    for (const [key, input] of Object.entries(fields)) {
      await invoke("cmd_update_setting", { key, value: input.value });
    }
    await invoke("cmd_apply_settings");
    showStatus("Settings saved!", false);
    setTimeout(hideWindow, 800);
  } catch (e) {
    showStatus(`Error: ${e}`, true);
  }
});

document.getElementById("btn-cancel")!.addEventListener("click", hideWindow);

// Hide instead of destroy when close button is clicked
getCurrentWindow().onCloseRequested(async (event) => {
  event.preventDefault();
  hideWindow();
});

// Reload settings each time window gains focus
getCurrentWindow().onFocusChanged(({ payload: focused }) => {
  if (focused) {
    loadSettings();
  }
});

loadSettings();
