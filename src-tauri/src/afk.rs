#[cfg(target_os = "windows")]
pub fn get_idle_seconds() -> u64 {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::System::SystemInformation::GetTickCount;

    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };

    unsafe {
        if GetLastInputInfo(&mut info).as_bool() {
            let tick_count = GetTickCount();
            let idle_ms = tick_count.wrapping_sub(info.dwTime);
            return (idle_ms / 1000) as u64;
        }
    }
    0
}

#[cfg(target_os = "macos")]
pub fn get_idle_seconds() -> u64 {
    use std::process::Command;
    let output = Command::new("ioreg")
        .args(["-c", "IOHIDSystem", "-d", "4"])
        .output();

    if let Ok(out) = output {
        let s = String::from_utf8_lossy(&out.stdout);
        for line in s.lines() {
            if line.contains("HIDIdleTime") {
                if let Some(val) = line.split('=').last() {
                    if let Ok(ns) = val.trim().parse::<u64>() {
                        return ns / 1_000_000_000;
                    }
                }
            }
        }
    }
    0
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn get_idle_seconds() -> u64 {
    0
}
