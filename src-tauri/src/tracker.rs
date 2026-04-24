use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Mutex, OnceLock};
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

/// Last known active window — updated by the tracking loop, read by get_current_window.
/// This avoids spawning osascript on every JS poll.
static LAST_WINDOW: OnceLock<Mutex<Option<ActiveWindow>>> = OnceLock::new();

/// Cached result of whether any app is preventing display sleep (video/calls).
/// Updated every 15 s by a background thread so the tracking loop never blocks.
static DISPLAY_SLEEP_PREVENTED: AtomicBool = AtomicBool::new(false);

/// Cached idle state, updated every 2 s by a background thread.
/// Avoids calling `ioreg` (slow subprocess) on every tracking tick.
static IS_IDLE_CACHED: AtomicBool = AtomicBool::new(false);
static IDLE_THRESHOLD_CACHE: AtomicI64 = AtomicI64::new(300);

fn last_window_cache() -> &'static Mutex<Option<ActiveWindow>> {
    LAST_WINDOW.get_or_init(|| Mutex::new(None))
}

pub fn start_tracking_loop() {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let idle_threshold = 300i64;
    IDLE_THRESHOLD_CACHE.store(idle_threshold, Ordering::Relaxed);

    // Background thread: refreshes display-sleep-prevented (pmset) every 15 s.
    std::thread::spawn(|| {
        loop {
            DISPLAY_SLEEP_PREVENTED.store(check_display_sleep_prevented(), Ordering::Relaxed);
            std::thread::sleep(Duration::from_secs(15));
        }
    });

    // Background thread: refreshes idle state (ioreg) every 2 s.
    // Keeps the tracking thread from ever blocking on `ioreg`.
    std::thread::spawn(|| {
        loop {
            let threshold = IDLE_THRESHOLD_CACHE.load(Ordering::Relaxed);
            IS_IDLE_CACHED.store(is_idle_now(threshold), Ordering::Relaxed);
            std::thread::sleep(Duration::from_secs(2));
        }
    });
    std::thread::spawn(|| {
        let mut last: Option<ActiveWindow> = None;
        let idle_threshold = IDLE_THRESHOLD_CACHE.load(Ordering::Relaxed);

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

            if IS_IDLE_CACHED.load(Ordering::Relaxed) && !is_engaged() {
                if let Some(prev) = last.take() {
                    let now = Utc::now().timestamp();
                    let id = CURRENT_ACTIVITY_ID.load(Ordering::SeqCst);
                    if id > 0 {
                        let _ = crate::db::finish_activity(id, now - idle_threshold);
                        CURRENT_ACTIVITY_ID.store(0, Ordering::SeqCst);
                    }
                    let _ = prev;
                    // Clear the cache so is_engaged() sees fresh data on resume,
                    // not stale meeting-app window that would block idle detection.
                    if let Ok(mut guard) = last_window_cache().lock() {
                        *guard = None;
                    }
                }
                continue;
            }

            if let Some(mut current) = get_active_window() {
                let changed = last.as_ref().map(|w| {
                    w.app_name != current.app_name || w.window_title != current.window_title
                }).unwrap_or(true);

                if changed {
                    // Only fetch the browser URL when the window actually changed —
                    // this is the expensive osascript call (up to 2 s) and is
                    // pointless on ticks where nothing has switched.
                    current.url = get_browser_url(&current.app_name);
                } else if let Some(ref prev) = last {
                    // Reuse the URL from the previous tick (same window).
                    current.url = prev.url.clone();
                }

                // Update the cache so get_current_window() can read it without
                // spawning a new osascript process.
                if let Ok(mut guard) = last_window_cache().lock() {
                    *guard = Some(current.clone());
                }

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

                            // Only advance `last` on success — if save failed,
                            // next tick will retry (changed=true again via last=None).
                            last = Some(current);
                        }
                        Err(_) => {}
                    }
                }
            } else {
                // Window gone (idle handled above) — clear cache
                if let Ok(mut guard) = last_window_cache().lock() {
                    *guard = None;
                }
            }
        }
    });
}

pub fn get_current_window() -> Option<ActiveWindow> {
    // Read from the cache populated by the tracking loop — never spawns osascript.
    last_window_cache().lock().ok()?.clone()
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

/// Run an osascript snippet with a hard timeout.
/// If the process doesn't respond within `timeout`, it is killed and `None` is returned.
/// This prevents the tracking thread from blocking forever when osascript hangs
/// (which happens regularly right after the system wakes from idle or sleep).
#[cfg(target_os = "macos")]
fn run_osascript(script: &str, timeout: Duration) -> Option<String> {
    use std::io::Read;
    let mut child = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        let _ = tx.send(buf);
    });
    match rx.recv_timeout(timeout) {
        Ok(bytes) => {
            let _ = child.wait(); // reap
            let s = String::from_utf8(bytes).ok()?.trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait(); // reap zombie
            None
        }
    }
}

#[cfg(target_os = "macos")]
pub fn get_active_window() -> Option<ActiveWindow> {
    let result = run_osascript(r#"
tell application "System Events"
    set frontApp to name of first application process whose frontmost is true
    set frontTitle to ""
    try
        set frontTitle to name of front window of (first process whose frontmost is true)
    end try
    return frontApp & "|" & frontTitle
end tell
    "#, Duration::from_secs(3))?;

    let parts: Vec<&str> = result.splitn(2, '|').collect();
    let app_name = parts.get(0).unwrap_or(&"").trim().to_string();
    if app_name.is_empty() { return None; }
    // URL is NOT fetched here — it is fetched by the tracking loop only when
    // the window changes, keeping the hot-path osascript calls to one per tick.

    Some(ActiveWindow {
        app_name,
        window_title: parts.get(1).unwrap_or(&"").trim().to_string(),
        url: None,
        timestamp: Utc::now().timestamp(),
    })
}

#[cfg(target_os = "macos")]
fn get_browser_url(app_name: &str) -> Option<String> {
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
        "Atlas" | "Atlas Browser" =>
            r#"tell application "Atlas" to return URL of active tab of front window"#,
        "Orion" =>
            r#"tell application "Orion" to return URL of active tab of front window"#,
        _ => return None,
    };
    run_osascript(script, Duration::from_secs(2))
}

#[cfg(target_os = "windows")]
pub fn get_active_window() -> Option<ActiveWindow> {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};
    use windows::Win32::System::Threading::{GetWindowThreadProcessId, OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};
    use windows::Win32::System::ProcessStatus::GetModuleFileNameExW;

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() { return None; }

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

/// Reads the cached HIDIdleTime from ioreg. Only called from the background watcher thread.
#[cfg(target_os = "macos")]
fn is_idle_now(threshold_secs: i64) -> bool {
    let output = std::process::Command::new("ioreg")
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

#[cfg(not(target_os = "macos"))]
fn is_idle_now(_threshold_secs: i64) -> bool {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
        use windows::Win32::System::SystemInformation::GetTickCount;
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut info).as_bool() {
            let now = GetTickCount();
            let idle_ms = now.wrapping_sub(info.dwTime);
            return (idle_ms / 1000) as i64 >= _threshold_secs;
        }
    }
    false
}

#[cfg(target_os = "macos")]
fn check_display_sleep_prevented() -> bool {
    let Ok(out) = std::process::Command::new("pmset")
        .args(["-g", "assertions"])
        .output()
    else { return false; };
    let s = String::from_utf8_lossy(&out.stdout);
    for line in s.lines() {
        if line.contains("PreventUserIdleDisplaySleep") {
            if let Some(val) = line.split_whitespace().last() {
                if val != "0" { return true; }
            }
        }
    }
    false
}

#[cfg(not(target_os = "macos"))]
fn check_display_sleep_prevented() -> bool { false }

/// Returns true when the user is likely in a meeting or watching video,
/// even if the mouse/keyboard has been idle — so we don't cut the activity.
#[cfg(target_os = "macos")]
fn is_engaged() -> bool {
    // 1. Cached pmset result — covers any app preventing display sleep
    //    (video players, screen share, calls) without blocking the tracking thread.
    if DISPLAY_SLEEP_PREVENTED.load(Ordering::Relaxed) {
        return true;
    }

    // 2. Window name / title check as a secondary signal.
    let Ok(guard) = last_window_cache().lock() else { return false; };
    let Some(ref win) = *guard else { return false; };
    let app   = win.app_name.to_lowercase();
    let title = win.window_title.to_lowercase();

    // Meeting apps
    let meeting_app = app.contains("zoom")    || app.contains("teams")
                   || app.contains("webex")   || app.contains("facetime")
                   || app.contains("discord") || app.contains("slack");
    let meeting_title = title.contains("google meet")   || title.contains("zoom meeting")
                     || title.contains("meet.google")    || title.contains("teams meeting");

    // Video player apps
    let video_app = app == "vlc"             || app == "quicktime player"
                 || app == "iina"            || app.starts_with("infuse")
                 || app == "plex"            || app == "mpv"
                 || app == "elmedia player"  || app == "movist"
                 || app == "apple tv";

    // Video in browser — tab title contains streaming service name
    let video_title = title.contains("youtube")     || title.contains("netflix")
                   || title.contains("twitch")      || title.contains("disney+")
                   || title.contains("prime video") || title.contains("hbo max")
                   || title.contains("apple tv+")   || title.contains("hulu");

    meeting_app || meeting_title || video_app || video_title
}

#[cfg(not(target_os = "macos"))]
fn is_engaged() -> bool {
    false
}

