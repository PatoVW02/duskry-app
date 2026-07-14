use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ActiveWindow {
    pub app_name: String,
    pub window_title: String,
    pub url: Option<String>,
    pub file_path: Option<String>,
    pub timestamp: i64,
}

#[cfg(target_os = "macos")]
struct FrontWindowMetadata {
    app_name: String,
    raw_title: String,
    document_url: Option<String>,
    document_path: Option<String>,
}

static RUNNING: AtomicBool = AtomicBool::new(false);
static SUPPORT_THREADS_STARTED: AtomicBool = AtomicBool::new(false);
static WATCHDOG_RUNNING: AtomicBool = AtomicBool::new(false);
static TRACKER_HEARTBEAT_TS: AtomicI64 = AtomicI64::new(0);
static CURRENT_ACTIVITY_ID: AtomicI64 = AtomicI64::new(0);
static LAST_TRUSTWORTHY_OBSERVATION_TS: AtomicI64 = AtomicI64::new(0);
static WORKER_GENERATION: AtomicU64 = AtomicU64::new(0);

const WATCHDOG_INTERVAL_SECS: u64 = 60;
const TRACKER_STALE_AFTER_SECS: i64 = 90;
const MAX_TRACKER_GAP_SECS: i64 = 30;
const MAX_CONSECUTIVE_WINDOW_MISSES: u32 = 2;

/// The project set by the menu bar "focus" selector. 0 = none.
pub static ACTIVE_PROJECT_ID: AtomicI64 = AtomicI64::new(0);
/// When true the tracking loop stops recording new activities.
pub static TRACKING_PAUSED: AtomicBool = AtomicBool::new(false);

/// Last known active window — updated by the tracking loop, read by get_current_window.
/// This avoids spawning osascript on every JS poll.
static LAST_WINDOW: OnceLock<Mutex<Option<ActiveWindow>>> = OnceLock::new();

/// Cached result of whether any app is preventing display sleep (video/calls).
/// Updated every 15 s by a background thread so the tracking loop never blocks.
static DISPLAY_SLEEP_PREVENTED: AtomicBool = AtomicBool::new(false);

/// Cached idle state, updated every 2 s by a background thread.
/// Avoids calling `ioreg` (slow subprocess) on every tracking tick.
static IS_IDLE_CACHED: AtomicBool = AtomicBool::new(false);
pub static IDLE_THRESHOLD_CACHE: AtomicI64 = AtomicI64::new(300);
/// Raw HIDIdleTime in seconds, updated alongside IS_IDLE_CACHED.
/// Used to detect input events (click / keystroke) when the value resets to ~0.
static IDLE_SECS_CACHE: AtomicI64 = AtomicI64::new(0);

fn current_local_day_key() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn active_project_for_today(enforce_free_project_limit: bool) -> i64 {
    let active_pid = ACTIVE_PROJECT_ID.load(Ordering::SeqCst);
    if active_pid <= 0 {
        return 0;
    }

    let stored_day = crate::db::get_setting("active_project_date").unwrap_or_default();
    let project_still_available =
        !enforce_free_project_limit || crate::validate_project_access(active_pid).is_ok();
    if stored_day == current_local_day_key() && project_still_available {
        return active_pid;
    }

    ACTIVE_PROJECT_ID.store(0, Ordering::SeqCst);
    let _ = crate::db::set_setting("active_project_id", "0");
    let _ = crate::db::set_setting("active_project_date", "");
    crate::logger::tlog(if project_still_available {
        "Focus project reset for a new local day"
    } else {
        "Focus project reset because it is locked on the current plan"
    });
    0
}

fn last_window_cache() -> &'static Mutex<Option<ActiveWindow>> {
    LAST_WINDOW.get_or_init(|| Mutex::new(None))
}

pub fn start_tracking_loop() {
    crate::logger::tlog("start_tracking_loop requested");
    start_support_threads_once();
    start_watchdog_once();
    start_tracking_worker();
}

fn observation_gap_exceeded(previous_tick: i64, current_tick: i64) -> bool {
    previous_tick > 0
        && (current_tick < previous_tick
            || current_tick.saturating_sub(previous_tick) > MAX_TRACKER_GAP_SECS)
}

fn should_end_attribution_after_misses(misses: u32) -> bool {
    misses >= MAX_CONSECUTIVE_WINDOW_MISSES
}

fn discontinuity_end_at(previous_tick: i64, current_tick: i64, last_observed: i64) -> i64 {
    if current_tick < previous_tick {
        current_tick
    } else {
        last_observed
    }
}

fn finish_current_activity_at(end_at: i64, reason: &str) {
    let activity_id = CURRENT_ACTIVITY_ID.swap(0, Ordering::SeqCst);
    if activity_id <= 0 {
        return;
    }
    let safe_end_at = end_at.max(0);
    match crate::db::finish_activity(activity_id, safe_end_at) {
        Ok(()) => crate::logger::tlog(&format!(
            "  Finished activity #{} at last observation ({})",
            activity_id, reason
        )),
        Err(error) => crate::logger::tlog(&format!(
            "  Could not finish activity #{} during {}: {}",
            activity_id, reason, error
        )),
    }
}

/// Stop attribution synchronously before a real process exit. The last window
/// observation, rather than the exit wall clock, is the trustworthy boundary.
pub fn stop_tracking_for_exit() {
    WORKER_GENERATION.fetch_add(1, Ordering::SeqCst);
    RUNNING.store(false, Ordering::SeqCst);
    let last_observed = LAST_TRUSTWORTHY_OBSERVATION_TS.load(Ordering::SeqCst);
    finish_current_activity_at(last_observed, "application exit");
}

fn start_support_threads_once() {
    if SUPPORT_THREADS_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    // Read persisted idle threshold; default 300 s (5 min).
    let idle_threshold = crate::db::get_setting("idle_threshold_secs")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(300);
    IDLE_THRESHOLD_CACHE.store(idle_threshold, Ordering::Relaxed);
    crate::logger::tlog(&format!(
        "Tracker support monitors starting (idle_threshold={}s)",
        idle_threshold
    ));

    // Background thread: refreshes display-sleep-prevented (pmset) every 15 s.
    std::thread::spawn(|| loop {
        DISPLAY_SLEEP_PREVENTED.store(check_display_sleep_prevented(), Ordering::Relaxed);
        std::thread::sleep(Duration::from_secs(15));
    });

    // Background thread: refreshes idle state (ioreg) every 2 s.
    // Keeps the tracking thread from ever blocking on `ioreg`.
    std::thread::spawn(|| loop {
        let threshold = IDLE_THRESHOLD_CACHE.load(Ordering::Relaxed);
        let secs = idle_secs_now();
        IDLE_SECS_CACHE.store(secs, Ordering::Relaxed);
        IS_IDLE_CACHED.store(secs >= threshold, Ordering::Relaxed);
        std::thread::sleep(Duration::from_secs(2));
    });
}

fn start_watchdog_once() {
    if WATCHDOG_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    std::thread::spawn(|| {
        crate::logger::tlog(&format!(
            "Tracker watchdog started (interval={}s stale_after={}s)",
            WATCHDOG_INTERVAL_SECS, TRACKER_STALE_AFTER_SECS
        ));
        let mut last_ok_log = 0i64;
        let mut last_paused_log = 0i64;
        let mut last_idle_log = 0i64;
        loop {
            let now = Utc::now().timestamp();

            if TRACKING_PAUSED.load(Ordering::SeqCst) {
                if now - last_paused_log >= 300 {
                    last_paused_log = now;
                    crate::logger::tlog("Watchdog: tracker check deferred while manually paused");
                }
                std::thread::sleep(Duration::from_secs(WATCHDOG_INTERVAL_SECS));
                continue;
            }

            let idle_secs = IDLE_SECS_CACHE.load(Ordering::Relaxed);
            if IS_IDLE_CACHED.load(Ordering::Relaxed) && !is_engaged() {
                if now - last_idle_log >= 300 {
                    last_idle_log = now;
                    crate::logger::tlog(&format!(
                        "Watchdog: tracker check deferred while idle (idle={}s)",
                        idle_secs
                    ));
                }
                std::thread::sleep(Duration::from_secs(WATCHDOG_INTERVAL_SECS));
                continue;
            }

            let heartbeat = TRACKER_HEARTBEAT_TS.load(Ordering::SeqCst);
            let running = RUNNING.load(Ordering::SeqCst);
            let stale = heartbeat > 0 && now - heartbeat > TRACKER_STALE_AFTER_SECS;
            let heartbeat_age = if heartbeat > 0 { now - heartbeat } else { -1 };

            if !running || stale {
                crate::logger::tlog(&format!(
                    "Watchdog: restarting tracker (running={} heartbeat_age={}s idle={}s)",
                    running, heartbeat_age, idle_secs
                ));
                RUNNING.store(false, Ordering::SeqCst);
                start_tracking_worker();
                crate::logger::tlog("Watchdog: restart signal sent");
            } else if now - last_ok_log >= 300 {
                last_ok_log = now;
                crate::logger::tlog(&format!(
                    "Watchdog: tracker healthy (heartbeat_age={}s idle={}s activity=#{})",
                    heartbeat_age,
                    idle_secs,
                    CURRENT_ACTIVITY_ID.load(Ordering::SeqCst)
                ));
            }
            std::thread::sleep(Duration::from_secs(WATCHDOG_INTERVAL_SECS));
        }
    });
}

fn start_tracking_worker() {
    if RUNNING.swap(true, Ordering::SeqCst) {
        crate::logger::tlog("start_tracking_loop called but already running — skipped");
        return;
    }
    crate::logger::tlog("Tracking loop starting");
    let now = Utc::now().timestamp();
    let prev_id = CURRENT_ACTIVITY_ID.swap(0, Ordering::SeqCst);
    if prev_id > 0 {
        let recovery_end = LAST_TRUSTWORTHY_OBSERVATION_TS
            .load(Ordering::SeqCst)
            .max(0);
        let _ = crate::db::finish_activity(prev_id, recovery_end);
        crate::logger::tlog(&format!(
            "  Finished stale activity #{} before tracker start",
            prev_id
        ));
    }
    match crate::db::close_open_activities(now) {
        Ok(count) if count > 0 => crate::logger::tlog(&format!(
            "  Repaired {} open activit{} before tracker start",
            count,
            if count == 1 { "y" } else { "ies" }
        )),
        Ok(_) => {}
        Err(e) => crate::logger::tlog(&format!("  Failed to repair open activities: {}", e)),
    }
    TRACKER_HEARTBEAT_TS.store(Utc::now().timestamp(), Ordering::SeqCst);
    let generation = WORKER_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
            tracking_worker_loop(generation);
        }));
        if WORKER_GENERATION.load(Ordering::SeqCst) == generation {
            let last_observed = LAST_TRUSTWORTHY_OBSERVATION_TS.load(Ordering::SeqCst);
            finish_current_activity_at(last_observed, "tracker worker exit");
            RUNNING.store(false, Ordering::SeqCst);
        }
        if result.is_err() {
            crate::logger::tlog(&format!(
                "Tracker worker #{} panicked; watchdog will restart it",
                generation
            ));
        } else {
            crate::logger::tlog(&format!(
                "Tracker worker #{} exited; watchdog will restart it if needed",
                generation
            ));
        }
    });
}

fn tracking_worker_loop(generation: u64) {
    let mut last: Option<ActiveWindow> = None;
    let idle_threshold = IDLE_THRESHOLD_CACHE.load(Ordering::Relaxed);
    let mut was_idle = false; // track transitions for resume logging
    let mut was_paused = false;
    let mut last_heartbeat = Utc::now().timestamp();
    let mut prev_idle_secs: i64 = -1;
    let mut tick_count: u64 = 0;
    let mut previous_tick_ts = Utc::now().timestamp();
    let mut consecutive_window_misses = 0_u32;

    crate::logger::tlog(&format!(
        "Tracker worker #{} started (idle_threshold={}s, tick=5s)",
        generation, idle_threshold
    ));

    loop {
        std::thread::sleep(Duration::from_secs(5));
        if WORKER_GENERATION.load(Ordering::SeqCst) != generation {
            crate::logger::tlog(&format!(
                "Tracker worker #{} exiting after replacement",
                generation
            ));
            break;
        }
        let tick_ts = Utc::now().timestamp();
        TRACKER_HEARTBEAT_TS.store(tick_ts, Ordering::SeqCst);

        // Threads are suspended while the computer sleeps. Never bridge a
        // large wall-clock gap onto the activity that happened before sleep.
        if observation_gap_exceeded(previous_tick_ts, tick_ts) {
            let last_observed = LAST_TRUSTWORTHY_OBSERVATION_TS.load(Ordering::SeqCst);
            let end_at = discontinuity_end_at(previous_tick_ts, tick_ts, last_observed);
            finish_current_activity_at(end_at, "sleep or clock discontinuity");
            last = None;
            consecutive_window_misses = 0;
            if let Ok(mut guard) = last_window_cache().lock() {
                *guard = None;
            }
            crate::logger::tlog(&format!(
                "Tracker gap detected ({}s); starting fresh attribution",
                tick_ts.saturating_sub(previous_tick_ts)
            ));
        }
        previous_tick_ts = tick_ts;

        // ── Pause check ──────────────────────────────────────────
        if TRACKING_PAUSED.load(Ordering::SeqCst) {
            if !was_paused {
                was_paused = true;
                crate::logger::tlog("Tracking paused manually");
            }
            let prev_id = CURRENT_ACTIVITY_ID.load(Ordering::SeqCst);
            if prev_id > 0 {
                let now = Utc::now().timestamp();
                let _ = crate::db::finish_activity(prev_id, now);
                crate::logger::tlog(&format!(
                    "  Finished activity #{} due to manual pause",
                    prev_id
                ));
                CURRENT_ACTIVITY_ID.store(0, Ordering::SeqCst);
                last = None;
            }
            continue;
        }
        if was_paused {
            was_paused = false;
            crate::logger::tlog("Tracking resumed (manual pause lifted)");
        }

        // ── Per-tick state ───────────────────────────────────────
        tick_count += 1;
        let idle_secs = IDLE_SECS_CACHE.load(Ordering::Relaxed);

        // Input event: HIDIdleTime reset from >5 s to ≤2 s = click or keystroke
        if prev_idle_secs > 5 && idle_secs <= 2 {
            let act_id = CURRENT_ACTIVITY_ID.load(Ordering::SeqCst);
            crate::logger::tlog(&format!(
                "Input — idle reset {}s → {}s  (activity=#{}  window={})",
                prev_idle_secs,
                idle_secs,
                act_id,
                last.as_ref().map(|w| w.app_name.as_str()).unwrap_or("none")
            ));
        }
        prev_idle_secs = idle_secs;

        // ── 60 s heartbeat ───────────────────────────────────────
        let now_ts = Utc::now().timestamp();
        if now_ts - last_heartbeat >= 60 {
            last_heartbeat = now_ts;
            let act_id = CURRENT_ACTIVITY_ID.load(Ordering::SeqCst);
            let win_desc = last
                .as_ref()
                .map(|w| format!("{} | {}", w.app_name, w.window_title))
                .unwrap_or_else(|| "none".to_string());
            if act_id > 0 {
                crate::logger::tlog(&format!(
                    "♥ activity #{} active — idle={}s  [{}]",
                    act_id, idle_secs, win_desc
                ));
            } else {
                crate::logger::tlog(&format!(
                    "♥ loop alive — idle={}s  no active activity",
                    idle_secs
                ));
            }
        }

        if IS_IDLE_CACHED.load(Ordering::Relaxed) && !is_engaged() {
            if let Some(prev) = last.take() {
                let now = Utc::now().timestamp();
                let id = CURRENT_ACTIVITY_ID.load(Ordering::SeqCst);
                if id > 0 {
                    // End the activity at `now` — the idle window is counted as
                    // part of the session (the user was still in that context).
                    // We only stop *future* recording, not backdate the end.
                    let _ = crate::db::finish_activity(id, now);
                    crate::logger::tlog(&format!(
                        "Idle >{}s — stopped activity #{} at now (was: {} | {})",
                        idle_threshold, id, prev.app_name, prev.window_title
                    ));
                    CURRENT_ACTIVITY_ID.store(0, Ordering::SeqCst);
                }
                let _ = prev;
                // Clear the cache so is_engaged() sees fresh data on resume,
                // not stale meeting-app window that would block idle detection.
                if let Ok(mut guard) = last_window_cache().lock() {
                    *guard = None;
                }
                was_idle = true;
            }
            continue;
        }
        if was_idle {
            was_idle = false;
            crate::logger::tlog("User active again — resuming tracking");
        }

        if let Some(mut current) = get_active_window() {
            consecutive_window_misses = 0;
            if WORKER_GENERATION.load(Ordering::SeqCst) != generation {
                crate::logger::tlog(&format!(
                    "Tracker worker #{} exiting after stale window check",
                    generation
                ));
                break;
            }
            // Electron apps (VS Code, etc.) temporarily report an empty
            // window title when focus moves between internal panels.
            // Suppress the flicker: if the app hasn't changed and the new
            // title is empty while the previous title was non-empty, reuse
            // the previous title so we don't split the activity.
            if let Some(ref prev) = last {
                if current.app_name == prev.app_name
                    && current.window_title.is_empty()
                    && !prev.window_title.is_empty()
                {
                    current.window_title = prev.window_title.clone();
                }
            }

            let window_changed = last
                .as_ref()
                .map(|w| {
                    w.app_name != current.app_name
                        || w.window_title != current.window_title
                        || w.file_path != current.file_path
                })
                .unwrap_or(true);

            // Browser tabs can navigate without changing the window title. Refresh
            // their URL every 15 seconds so domain rules and reports do not go stale.
            let should_refresh_url = window_changed || tick_count.is_multiple_of(3);
            if should_refresh_url {
                let (url_observed, browser_url) = get_browser_url(&current.app_name);
                if url_observed {
                    current.url = browser_url;
                } else if current.url.is_none() && !window_changed {
                    current.url = last.as_ref().and_then(|w| w.url.clone());
                }
            } else if let Some(ref prev) = last {
                current.url = prev.url.clone();
            }
            let changed =
                window_changed || last.as_ref().map(|w| w.url != current.url).unwrap_or(false);

            // Periodic same-window tick log (every 15 s) so we can see the loop
            // is alive and what osascript is reporting even with no state changes.
            if !changed && tick_count.is_multiple_of(3) {
                crate::logger::tlog(&format!(
                    "  tick: frontmost=\"{}\" title=\"{}\"  idle={}s  activity=#{}",
                    current.app_name,
                    current.window_title,
                    idle_secs,
                    CURRENT_ACTIVITY_ID.load(Ordering::SeqCst)
                ));
            }

            if WORKER_GENERATION.load(Ordering::SeqCst) != generation {
                crate::logger::tlog(&format!(
                    "Tracker worker #{} exiting after stale URL check",
                    generation
                ));
                break;
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
                    CURRENT_ACTIVITY_ID.store(0, Ordering::SeqCst);
                    let duration = last.as_ref().map(|w| now - w.timestamp).unwrap_or(0);
                    crate::logger::tlog(&format!(
                        "  Finished activity #{} ({}s)",
                        prev_id, duration
                    ));
                }

                // Describe what changed: app switch vs title change
                match last.as_ref() {
                    Some(prev_win) if prev_win.app_name != current.app_name => {
                        crate::logger::tlog(&format!(
                            "App switch: {} → {}",
                            prev_win.app_name, current.app_name
                        ));
                    }
                    Some(prev_win) => {
                        crate::logger::tlog(&format!(
                            "Title change in {}: \"{}\" → \"{}\"",
                            current.app_name, prev_win.window_title, current.window_title
                        ));
                    }
                    None => {}
                }
                crate::logger::tlog(&format!(
                    "Window → {} | {}{}",
                    current.app_name,
                    current.window_title,
                    current
                        .url
                        .as_deref()
                        .map(|u| format!(" [{}]", u))
                        .unwrap_or_default()
                ));

                // start new activity
                let normalized_domain = current
                    .url
                    .as_deref()
                    .and_then(crate::rules::normalized_host);
                match crate::db::save_activity_start(
                    &current.app_name,
                    &current.window_title,
                    current.file_path.as_deref(),
                    normalized_domain.as_deref(),
                    now,
                ) {
                    Ok(new_id) => {
                        crate::logger::tlog(&format!("  Started activity #{}", new_id));
                        CURRENT_ACTIVITY_ID.store(new_id, Ordering::SeqCst);
                        LAST_TRUSTWORTHY_OBSERVATION_TS.store(now, Ordering::SeqCst);

                        // ── Daily focus notification ──────────────────
                        if crate::notify::should_send_daily_notification() {
                            crate::notify::mark_notification_sent();
                            crate::notify::send_focus_notification();
                        }

                        // ── Auto-assign with focus-project priority ───
                        if let Ok(rules) = crate::db::get_all_rules() {
                            if let Some(decision) = determine_project(&current, &rules) {
                                match crate::db::assign_activity_with_decision(
                                    new_id,
                                    decision.project_id,
                                    decision.source,
                                    decision.rule_id,
                                    decision.confidence,
                                    Some(&decision.reason),
                                ) {
                                    Ok(()) => crate::logger::tlog(&format!(
                                        "  Auto-assigned #{} to project {} ({})",
                                        new_id, decision.project_id, decision.reason
                                    )),
                                    Err(error) => crate::logger::tlog(&format!(
                                        "  Failed to auto-assign #{}: {}",
                                        new_id, error
                                    )),
                                }
                            }
                        }

                        // Only advance `last` on success — if save failed,
                        // next tick will retry (changed=true again via last=None).
                        last = Some(current);
                    }
                    Err(e) => {
                        crate::logger::tlog(&format!("  DB error saving activity: {}", e));
                    }
                }
            } else {
                let observed_at = Utc::now().timestamp();
                let activity_id = CURRENT_ACTIVITY_ID.load(Ordering::SeqCst);
                if activity_id > 0 {
                    if let Err(error) = crate::db::checkpoint_activity(activity_id, observed_at) {
                        crate::logger::tlog(&format!(
                            "  DB error checkpointing activity #{}: {}",
                            activity_id, error
                        ));
                    } else {
                        LAST_TRUSTWORTHY_OBSERVATION_TS.store(observed_at, Ordering::SeqCst);
                    }
                }
            }
        } else {
            // The OS could not safely identify the foreground process. This is
            // common for elevated Windows processes and transient macOS AX timeouts.
            crate::logger::tlog(&format!(
                "  tick: foreground window unavailable  idle={}s  activity=#{}",
                idle_secs,
                CURRENT_ACTIVITY_ID.load(Ordering::SeqCst)
            ));
            // Window gone (idle handled above) — clear cache
            if let Ok(mut guard) = last_window_cache().lock() {
                *guard = None;
            }
            consecutive_window_misses = consecutive_window_misses.saturating_add(1);
            if should_end_attribution_after_misses(consecutive_window_misses) {
                let last_observed = LAST_TRUSTWORTHY_OBSERVATION_TS.load(Ordering::SeqCst);
                finish_current_activity_at(last_observed, "foreground window unavailable");
                last = None;
            }
        }
    }
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
///
/// When no focus project is set, normal full-rules matching applies.
struct AssignmentDecision {
    project_id: i64,
    source: &'static str,
    rule_id: Option<i64>,
    confidence: Option<f64>,
    reason: String,
}

fn focus_decision(project_id: i64) -> AssignmentDecision {
    AssignmentDecision {
        project_id,
        source: "focus",
        rule_id: None,
        confidence: Some(1.0),
        reason: "focus project".to_string(),
    }
}

fn rule_decision(matched: crate::rules::RuleMatch) -> AssignmentDecision {
    let learned = matched.source == "learned";
    AssignmentDecision {
        project_id: matched.project_id,
        source: if learned {
            "learned_rule"
        } else {
            "manual_rule"
        },
        rule_id: matched.rule_id,
        confidence: matched.confidence.or((!learned).then_some(1.0)),
        reason: if learned {
            format!(
                "learned rule{} at {:.0}% confidence",
                matched
                    .rule_id
                    .map(|id| format!(" #{id}"))
                    .unwrap_or_default(),
                matched.confidence.unwrap_or(0.0) * 100.0
            )
        } else {
            format!(
                "manual rule{}",
                matched
                    .rule_id
                    .map(|id| format!(" #{id}"))
                    .unwrap_or_default()
            )
        },
    }
}

fn determine_project(
    window: &ActiveWindow,
    rules: &[crate::db::Rule],
) -> Option<AssignmentDecision> {
    let tier = crate::license::get_effective_tier();
    let rules_locked = crate::feature_flags::billing_plans_enabled()
        && (tier == crate::license::AppTier::Free || tier == crate::license::AppTier::Expired);

    // Trial expiry can happen while the app stays open. Re-check a stored
    // focus as soon as the effective tier becomes Free/Expired so a locked
    // fourth project cannot keep receiving activity until the next UI refresh.
    let active_pid = active_project_for_today(rules_locked);

    if active_pid > 0 {
        // Free/Expired: rules don't apply, focus project always wins
        if rules_locked {
            return Some(focus_decision(active_pid));
        }
        let rules_override = crate::db::get_setting("rules_override_active_project")
            .map(|v| v == "true")
            .unwrap_or(true); // default ON

        if rules_override {
            // App/URL rules beat the focus project
            if let Some(matched) = crate::rules::apply_app_url_rules(window, rules) {
                return Some(rule_decision(matched));
            }
        }
        return Some(focus_decision(active_pid));
    }

    // No focus project → rules normally (skipped on free/expired)
    if rules_locked {
        return None;
    }
    crate::rules::apply_rules(window, rules).map(rule_decision)
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
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait(); // reap zombie
            crate::logger::tlog(&format!(
                "osascript timed out (script truncated): {}...",
                &script[..script.len().min(80)]
            ));
            None
        }
    }
}

#[cfg(target_os = "macos")]
pub fn get_active_window() -> Option<ActiveWindow> {
    let metadata = get_front_window_metadata()?;
    let app_name = metadata.app_name;
    let raw_title = metadata.raw_title;
    let file_path = metadata.document_path;
    let document_url = metadata.document_url;
    // URL is NOT fetched here — it is fetched by the tracking loop only when
    // the window changes, keeping the hot-path osascript calls to one per tick.
    let window_title = get_browser_title(&app_name)
        .filter(|title| !title.trim().is_empty())
        .unwrap_or(raw_title);

    Some(ActiveWindow {
        app_name,
        window_title,
        url: document_url,
        file_path,
        timestamp: Utc::now().timestamp(),
    })
}

#[cfg(target_os = "macos")]
fn get_front_window_metadata() -> Option<FrontWindowMetadata> {
    let result = run_osascript(
        r#"
tell application "System Events"
    set frontProc to first application process whose frontmost is true
    set frontApp to name of frontProc
    set frontTitle to ""
    set frontDocument to ""
    try
        set frontWindow to front window of frontProc
        try
            set frontTitle to value of attribute "AXTitle" of frontWindow
        end try
        if frontTitle is "" then
            try
                set frontTitle to title of frontWindow
            end try
        end if
        try
            set frontDocument to value of attribute "AXDocument" of frontWindow
        end try
    end try
    set separatorCharacter to ASCII character 31
    return frontApp & separatorCharacter & frontTitle & separatorCharacter & frontDocument
end tell
    "#,
        Duration::from_secs(3),
    )?;

    let parts: Vec<&str> = result.splitn(3, '\u{1f}').collect();
    let app_name = parts.first().unwrap_or(&"").trim().to_string();
    if app_name.is_empty() {
        return None;
    }
    let raw_title = parts.get(1).unwrap_or(&"").trim().to_string();
    let (document_url, document_path) = classify_ax_document(parts.get(2).copied().unwrap_or(""));

    Some(FrontWindowMetadata {
        app_name,
        raw_title,
        document_url,
        document_path,
    })
}

#[cfg(target_os = "macos")]
fn classify_ax_document(value: &str) -> (Option<String>, Option<String>) {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return (None, None);
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("https://") || lower.starts_with("http://") {
        return (crate::rules::normalized_host(trimmed), None);
    }
    if lower.starts_with("file://") {
        let path = url::Url::parse(trimmed)
            .ok()
            .and_then(|document| document.to_file_path().ok())
            .map(|path| path.to_string_lossy().into_owned());
        return (None, path);
    }
    if std::path::Path::new(trimmed).is_absolute() {
        return (None, Some(trimmed.to_string()));
    }
    // AXDocument can expose custom deep links (for example vscode://) whose
    // query may contain private state. Unknown URIs and relative strings are
    // not file paths and must not enter activity or learning storage.
    (None, None)
}

#[cfg(target_os = "macos")]
fn get_browser_title(app_name: &str) -> Option<String> {
    let script = match app_name {
        "Google Chrome" => {
            r#"tell application "Google Chrome" to return title of active tab of front window"#
        }
        "Chromium" => {
            r#"tell application "Chromium" to return title of active tab of front window"#
        }
        "Safari" => r#"tell application "Safari" to return name of current tab of front window"#,
        "Microsoft Edge" => {
            r#"tell application "Microsoft Edge" to return title of active tab of front window"#
        }
        "Brave Browser" => {
            r#"tell application "Brave Browser" to return title of active tab of front window"#
        }
        "Arc" => r#"tell application "Arc" to return title of active tab of front window"#,
        "Atlas" | "Atlas Browser" => {
            r#"tell application "Atlas" to return title of active tab of front window"#
        }
        "Orion" => r#"tell application "Orion" to return title of active tab of front window"#,
        "ChatGPT" => r#"tell application "ChatGPT" to return title of front window"#,
        _ => return None,
    };
    run_osascript(script, Duration::from_secs(2))
}

#[cfg(target_os = "macos")]
fn get_browser_url(app_name: &str) -> (bool, Option<String>) {
    let script = match app_name {
        "Google Chrome" => {
            r#"tell application "Google Chrome" to return URL of active tab of front window"#
        }
        "Chromium" => r#"tell application "Chromium" to return URL of active tab of front window"#,
        "Safari" => r#"tell application "Safari" to return URL of current tab of front window"#,
        "Microsoft Edge" => {
            r#"tell application "Microsoft Edge" to return URL of active tab of front window"#
        }
        "Brave Browser" => {
            r#"tell application "Brave Browser" to return URL of active tab of front window"#
        }
        "Arc" => r#"tell application "Arc" to return URL of active tab of front window"#,
        "Atlas" | "Atlas Browser" => {
            r#"tell application "Atlas" to return URL of active tab of front window"#
        }
        "Orion" => r#"tell application "Orion" to return URL of active tab of front window"#,
        _ => return (false, None),
    };
    match run_osascript(script, Duration::from_secs(2)) {
        Some(raw_url) => (true, crate::rules::normalized_host(&raw_url)),
        None => (false, None),
    }
}

#[cfg(target_os = "windows")]
pub fn get_active_window() -> Option<ActiveWindow> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }

        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, &mut title_buf);
        let window_title = String::from_utf16_lossy(&title_buf[..title_len as usize]);

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        // QueryFullProcessImageNameW only needs limited query access. The old
        // GetModuleFileNameExW + VM_READ path failed for many sandboxed/UWP
        // apps and elevated foreground processes, dropping their activity.
        let mut path_buf = [0u16; 32_768];
        let mut path_len = path_buf.len() as u32;
        let path_result = QueryFullProcessImageNameW(
            proc,
            PROCESS_NAME_WIN32,
            PWSTR(path_buf.as_mut_ptr()),
            &mut path_len,
        );
        let _ = CloseHandle(proc);
        path_result.ok()?;
        let full_path = String::from_utf16_lossy(&path_buf[..path_len as usize]);
        let app_name = std::path::Path::new(&full_path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| full_path.clone());

        Some(ActiveWindow {
            app_name,
            window_title,
            url: None,
            file_path: (!full_path.is_empty()).then_some(full_path),
            timestamp: chrono::Utc::now().timestamp(),
        })
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn get_active_window() -> Option<ActiveWindow> {
    None
}

#[cfg(not(target_os = "macos"))]
fn get_browser_url(_app_name: &str) -> (bool, Option<String>) {
    (false, None)
}

/// Reads raw HIDIdleTime from ioreg and returns seconds. Only called from the background watcher thread.
#[cfg(target_os = "macos")]
fn idle_secs_now() -> i64 {
    let output = std::process::Command::new("ioreg")
        .args(["-c", "IOHIDSystem"])
        .output()
        .ok();
    if let Some(out) = output {
        let s = String::from_utf8_lossy(&out.stdout);
        if let Some(pos) = s.find("HIDIdleTime") {
            let rest = &s[pos..];
            if let Some(eq) = rest.find('=') {
                let num_str = rest[eq + 1..].split_whitespace().next().unwrap_or("0");
                if let Ok(ns) = num_str
                    .trim_end_matches(|c: char| !c.is_ascii_digit())
                    .parse::<u64>()
                {
                    return (ns / 1_000_000_000) as i64;
                }
            }
        }
    }
    0
}

#[cfg(target_os = "windows")]
fn idle_secs_now() -> i64 {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut info).as_bool() {
            let now = GetTickCount();
            let idle_ms = now.wrapping_sub(info.dwTime);
            return (idle_ms / 1000) as i64;
        }
    }
    0
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn idle_secs_now() -> i64 {
    0
}

#[cfg(target_os = "macos")]
fn check_display_sleep_prevented() -> bool {
    let Ok(out) = std::process::Command::new("pmset")
        .args(["-g", "assertions"])
        .output()
    else {
        return false;
    };
    let s = String::from_utf8_lossy(&out.stdout);
    for line in s.lines() {
        if line.contains("PreventUserIdleDisplaySleep") {
            if let Some(val) = line.split_whitespace().last() {
                if val != "0" {
                    return true;
                }
            }
        }
    }
    false
}

#[cfg(not(target_os = "macos"))]
fn check_display_sleep_prevented() -> bool {
    false
}

/// Returns true when the user is likely in a meeting or watching video,
/// even if the mouse/keyboard has been idle — so we don't cut the activity.
#[cfg(target_os = "macos")]
fn is_engaged() -> bool {
    // 1. Cached pmset result — covers any app preventing display sleep
    //    (video players, screen share, calls) without blocking the tracking thread.
    if DISPLAY_SLEEP_PREVENTED.load(Ordering::Relaxed) {
        crate::logger::tlog("Idle suppressed: display sleep prevented (video/screen-share/call)");
        return true;
    }

    // 2. Window name / title check as a secondary signal.
    let Ok(guard) = last_window_cache().lock() else {
        return false;
    };
    let Some(ref win) = *guard else {
        return false;
    };
    let app = win.app_name.to_lowercase();
    let title = win.window_title.to_lowercase();

    // Meeting apps
    let meeting_app = app.contains("zoom")
        || app.contains("teams")
        || app.contains("webex")
        || app.contains("facetime")
        || app.contains("discord")
        || app.contains("slack");
    let meeting_title = title.contains("google meet")
        || title.contains("zoom meeting")
        || title.contains("meet.google")
        || title.contains("teams meeting");

    // Video player apps
    let video_app = app == "vlc"
        || app == "quicktime player"
        || app == "iina"
        || app.starts_with("infuse")
        || app == "plex"
        || app == "mpv"
        || app == "elmedia player"
        || app == "movist"
        || app == "apple tv";

    // Video in browser — tab title contains streaming service name
    let video_title = title.contains("youtube")
        || title.contains("netflix")
        || title.contains("twitch")
        || title.contains("disney+")
        || title.contains("prime video")
        || title.contains("hbo max")
        || title.contains("apple tv+")
        || title.contains("hulu");

    let engaged = meeting_app || meeting_title || video_app || video_title;
    if engaged {
        crate::logger::tlog(&format!(
            "Idle suppressed: engaged app/title detected (app='{}' title='{}')",
            win.app_name, win.window_title
        ));
    }
    engaged
}

#[cfg(not(target_os = "macos"))]
fn is_engaged() -> bool {
    false
}

#[cfg(test)]
mod lifecycle_tests {
    use super::{
        discontinuity_end_at, observation_gap_exceeded, should_end_attribution_after_misses,
    };

    #[test]
    fn a_large_tick_gap_starts_a_new_attribution_window() {
        assert!(!observation_gap_exceeded(100, 130));
        assert!(observation_gap_exceeded(100, 131));
        assert!(observation_gap_exceeded(100, 99));
        assert!(!observation_gap_exceeded(0, 10_000));
        assert_eq!(discontinuity_end_at(100, 131, 100), 100);
        assert_eq!(discontinuity_end_at(100, 99, 100), 99);
    }

    #[test]
    fn transient_window_failures_are_tolerated_but_repeated_failures_end_attribution() {
        assert!(!should_end_attribution_after_misses(1));
        assert!(should_end_attribution_after_misses(2));
        assert!(should_end_attribution_after_misses(20));
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::classify_ax_document;

    #[test]
    fn ax_document_separates_websites_from_local_paths() {
        let (url, path) = classify_ax_document("https://docs.example.com/private?token=secret");
        assert_eq!(url.as_deref(), Some("docs.example.com"));
        assert_eq!(path, None);

        let (url, path) = classify_ax_document("file:///Users/test/My%20File.txt");
        assert_eq!(url, None);
        assert_eq!(path.as_deref(), Some("/Users/test/My File.txt"));
    }

    #[test]
    fn ax_document_rejects_custom_uris_and_relative_values() {
        assert_eq!(
            classify_ax_document("vscode://private/resource?token=secret"),
            (None, None)
        );
        assert_eq!(classify_ax_document("not/a/local/path"), (None, None));
        assert_eq!(
            classify_ax_document("/Users/test/project/file.rs"),
            (None, Some("/Users/test/project/file.rs".to_string()))
        );
    }
}
