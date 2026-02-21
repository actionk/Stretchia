use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum Mode {
    Sitting,
    Treadmill,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum Stage {
    Green,
    Yellow,
    Orange,
    Red,
    Critical,
}

impl Stage {
    pub fn as_str(&self) -> &'static str {
        match self {
            Stage::Green => "green",
            Stage::Yellow => "yellow",
            Stage::Orange => "orange",
            Stage::Red => "red",
            Stage::Critical => "red", // same color, different behavior
        }
    }
}

#[derive(Debug, Clone)]
pub struct TimerState {
    pub mode: Mode,
    pub elapsed_s: u64,
    pub treadmill_start: Option<i64>,
    pub sitting_before_s: u64,
    pub is_afk: bool,
    pub afk_threshold_s: u64,
    pub warn_at_min: u64,
    pub shake_at_min: u64,
}

impl TimerState {
    pub fn new() -> Self {
        Self {
            mode: Mode::Sitting,
            elapsed_s: 0,
            treadmill_start: None,
            sitting_before_s: 0,
            is_afk: false,
            afk_threshold_s: 300, // 5 minutes default
            warn_at_min: 30,
            shake_at_min: 60,
        }
    }

    pub fn calculate_stage(&self) -> Stage {
        let minutes = self.elapsed_s / 60;
        let warn = self.warn_at_min;
        let shake = self.shake_at_min;
        // Derive thresholds: green -> yellow at warn, orange at midpoint, red at shake, critical at shake+15
        let mid = warn + (shake - warn) / 2;
        let critical = shake + 15;
        if minutes < warn {
            Stage::Green
        } else if minutes < mid {
            Stage::Yellow
        } else if minutes < shake {
            Stage::Orange
        } else if minutes < critical {
            Stage::Red
        } else {
            Stage::Critical
        }
    }

    pub fn reset(&mut self) {
        self.sitting_before_s = self.elapsed_s;
        self.elapsed_s = 0;
        self.mode = Mode::Sitting;
        self.treadmill_start = None;
    }

    pub fn start_treadmill(&mut self) {
        self.sitting_before_s = self.elapsed_s;
        self.elapsed_s = 0;
        self.mode = Mode::Treadmill;
        self.treadmill_start = Some(chrono::Utc::now().timestamp());
    }

    pub fn stop_treadmill(&mut self) -> (i64, u64, u64) {
        let started = self.treadmill_start.unwrap_or(chrono::Utc::now().timestamp());
        let duration = self.elapsed_s;
        let sitting_before = self.sitting_before_s;
        self.elapsed_s = 0;
        self.mode = Mode::Sitting;
        self.treadmill_start = None;
        self.sitting_before_s = 0;
        (started, duration, sitting_before)
    }
}

#[derive(Serialize, Clone)]
pub struct TimerTickPayload {
    pub mode: String,
    pub elapsed_s: u64,
    pub stage: String,
    pub is_afk: bool,
    pub is_treadmill: bool,
}
