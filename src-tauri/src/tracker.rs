use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::time::Duration;
use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ActiveWindow {
    pub app_name: String,
    pub window_title: String,
    pub url: Option<String>,
    pub timestamp: i64,
}

static RUNNING: AtomicBool = AtomicBool::new(false);
static CURRENT_ACTIVITY_ID: AtomicI64 = AtomicI64::new(0);

/// The project set by the menu bar "focus" selector. 0 = none.
pub static ACTIVE_PROJECT_ID: AtomicI64  = AtomicI64::new(0);
/// When true the tracking loop stops recording new activities.
pub static TRACKING_PAUSED:   AtomicBool = AtomicBool::new(false);

pub fn start_tracking_loop() {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| {
        let mut last: Option<ActiveWindow> = None;
        let idle_threshold = 120i64;

        loop {
            std::thread::sleep(Duration::from_secs(5));

            // ── Pause check ──────────────────────────────────────────
            if TRACKING_PAUSED.load(Ordering::SeqCst) {
                let prev_id = CURRENT_ACTIVITY_ID.load(Ordering::SeqCst);
                if prev_id > 0 {
                    let now = Utc::now().timestamp();
                    let _ = crate::db::finish_activity(prev_id, now);
                    CURRENT_ACTIVITY_ID.store(0, Ordering::SeqCst);
                    last = None;
                }
                continue;
            }

            if is_idle(idle_threshold) {
                if let Some(prev) = last.take() {
                    let now = Utc::now().timestamp();
                    let id = CURRENT_ACTIVITY_ID.load(Ordering::SeqCst);
                    if id > 0 {
                        let _ = crate::db::finish_activity(id, now - idle_threshold);
                        CURRENT_ACTIVITY_ID.store(0, Ordering::SeqCst);
                    }
                    let _ = prev;
                }
                continue;
            }

            if let Some(current) = get_active_window() {
                let changed = last.as_ref().map(|w| {
                    w.app_name != current.app_name || w.window_title != current.window_title
                }).unwrap_or(true);

                if changed {
                    let now = Utc::now().timestamp();

                    // finish the previous activity
                    let prev_id = CURRENT_ACTIVITY_ID.load(Ordering::SeqCst);
                    if prev_id > 0 {
                        let _ = crate::db::finish_activity(prev_id, now);
                    }

                    // start new activity
                    match crate::db::save_activity_start(&current.app_name, &current.window_title, now) {
                        Ok(new_id) => {
                            CURRENT_ACTIVITY_ID.store(new_id, Ordering::SeqCst);

                            // ── Daily focus notification ──────────────────
                            if crate::notify::should_send_daily_notification() {
                                crate::notify::mark_notification_sent();
                                crate::notify::send_focus_notification();
                            }

                            // ── Auto-assign with focus-project priority ───
                            if let Ok(rules) = crate::db::get_all_rules() {
                                if let Some(pid) = determine_project(&current, &rules) {
                                    let _ = crate::db::assign_activity(new_id, pid, "rule");
                                }
                            }
                        }
                        Err(_) => {}
                    }

                    last = Some(current);
                }
            }
        }
    });
}

pub fn get_current_window() -> Option<ActiveWindow> {
    get_active_window()
}

/// Determine which project to assign a new activity to.
///
/// Priority (when a focus project is set):
///   - `rules_override_active_project = true` (default):
///       1. Any app-name or URL rule match → wins
///       2. Focus project
///   - `rules_override_active_project = false`:
///       1. Focus project (always wins)
/// When no focus project is set, normal full-rules matching applies.
fn determine_project(window: &ActiveWindow, rules: &[crate::db::Rule]) -> Option<i64> {
    let active_pid = ACTIVE_PROJECT_ID.load(Ordering::SeqCst);

    if active_pid > 0 {
        let rules_override = crate::db::get_setting("rules_override_active_project")
            .map(|v| v == "true")
            .unwrap_or(true); // default ON

        if rules_override {
            // App/URL rules beat the focus project
            if let Some(pid) = crate::rules::apply_app_url_rules(window, rules) {
                return Some(pid);
            }
        }
        return Some(active_pid);
    }

    // No focus project → use all rules normally
    crate::rules::apply_rules(window, rules)
}

#[cfg(target_os = "macos")]
pub fn get_active_window() -> Option<ActiveWindow> {
    use std::process::Command;

    let output = Command::new("osascript")
        .arg("-e")
        .arg(r#"
tell application "System Events"
    set frontApp to name of first application process whose frontmost is true
    set frontTitle to ""
    try
        set frontTitle to name of front window of (first process whose frontmost is true)
    end try
    return frontApp & "|" & frontTitle
end tell
        "#)
        .output()
        .ok()?;

    let result = String::from_utf8(output.stdout).ok()?;
    let result = result.trim();
    if result.is_empty() {
        return None;
    }
    let parts: Vec<&str> = result.splitn(2, '|').collect();
    let app_name = parts.get(0).unwrap_or(&"").trim().to_string();
    let url = get_browser_url(&app_name);

    Some(ActiveWindow {
        app_name,
        window_title: parts.get(1).unwrap_or(&"").trim().to_string(),
        url,
        timestamp: Utc::now().timestamp(),
    })
}

#[cfg(target_os = "macos")]
fn get_browser_url(app_name: &str) -> Option<String> {
    use std::process::Command;

    let script = match app_name {
        "Google Chrome" | "Chromium" =>
            r#"tell application "Google Chrome" to return URL of active tab of front window"#,
        "Safari" =>
            r#"tell application "Safari" to return URL of current tab of front window"#,
        "Microsoft Edge" =>
            r#"tell application "Microsoft Edge" to return URL of active tab of front window"#,
        "Brave Browser" =>
            r#"tell application "Brave Browser" to return URL of active tab of front window"#,
        "Arc" =>
            r#"tell application "Arc" to return URL of active tab of front window"#,
        _ => return None,
    };

    let out = Command::new("osascript")
        .arg("-e").arg(script)
        .output().ok()?;
    let url = String::from_utf8(out.stdout).ok()?.trim().to_string();
    if url.is_empty() { None } else { Some(url) }
}

#[cfg(target_os = "windows")]
pub fn get_active_window() -> Option<ActiveWindow> {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};
    use windows::Win32::System::Threading::{GetWindowThreadProcessId, OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};
    use windows::Win32::System::ProcessStatus::GetModuleFileNameExW;

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0 == 0 { return None; }

        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, &mut title_buf);
        let window_title = String::from_utf16_lossy(&title_buf[..title_len as usize]);

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let proc = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid).ok()?;
        let mut path_buf = [0u16; 512];
        let path_len = GetModuleFileNameExW(proc, None, &mut path_buf);
        let full_path = String::from_utf16_lossy(&path_buf[..path_len as usize]);
        let app_name = std::path::Path::new(&full_path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or(full_path);

        Some(ActiveWindow {
            app_name,
            window_title,
            url: None,
            timestamp: chrono::Utc::now().timestamp(),
        })
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn get_active_window() -> Option<ActiveWindow> {
    None
}

#[cfg(not(target_os = "macos"))]
fn get_browser_url(_app_name: &str) -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
fn is_idle(threshold_secs: i64) -> bool {
    use std::process::Command;
    let output = Command::new("ioreg")
        .args(["-c", "IOHIDSystem"])
        .output()
        .ok();
    if let Some(out) = output {
        let s = String::from_utf8_lossy(&out.stdout);
        if let Some(pos) = s.find("HIDIdleTime") {
            let rest = &s[pos..];
            if let Some(eq) = rest.find('=') {
                let num_str = rest[eq + 1..].trim().split_whitespace().next().unwrap_or("0");
                if let Ok(ns) = num_str.trim_end_matches(|c: char| !c.is_ascii_digit()).parse::<u64>() {
                    let secs = (ns / 1_000_000_000) as i64;
                    return secs >= threshold_secs;
                }
            }
        }
    }
    false
}

#[cfg(target_os = "windows")]
fn is_idle(threshold_secs: i64) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::GetLastInputInfo;
    use windows::Win32::UI::Input::KeyboardAndMouse::LASTINPUTINFO;
    use windows::Win32::System::SystemInformation::GetTickCount;
    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut info).as_bool() {
            let now = GetTickCount();
            let idle_ms = now.wrapping_sub(info.dwTime);
            return (idle_ms / 1000) as i64 >= threshold_secs;
        }
    }
    false
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn is_idle(_threshold_secs: i64) -> bool {
    false
}
