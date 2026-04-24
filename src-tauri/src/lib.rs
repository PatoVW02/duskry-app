mod db;
mod tracker;
mod rules;
mod license;
mod permissions;
mod notify;
mod tray;
mod logger;

use tauri::Manager;

// ─── Tracker log commands ─────────────────────────────────────────────────

#[tauri::command]
fn get_tracker_log(lines: Option<usize>) -> Vec<String> {
    logger::get_log_lines(lines.unwrap_or(300))
}

#[tauri::command]
fn get_tracker_log_path() -> String {
    logger::log_path_str()
}

#[tauri::command]
fn clear_tracker_log() {
    logger::clear_log();
}

// ─── Idle threshold ────────────────────────────────────────────────

#[tauri::command]
fn get_idle_threshold() -> i64 {
    tracker::IDLE_THRESHOLD_CACHE.load(std::sync::atomic::Ordering::Relaxed)
}

/// Update the idle threshold live (takes effect on next background-thread cycle).
/// Persists the value so it survives restarts.
#[tauri::command]
fn set_idle_threshold(secs: i64) -> Result<(), String> {
    let secs = secs.max(30); // sanity floor: never less than 30 s
    tracker::IDLE_THRESHOLD_CACHE.store(secs, std::sync::atomic::Ordering::Relaxed);
    db::set_setting("idle_threshold_secs", &secs.to_string()).map_err(|e| e.to_string())
}

// ─── Tracker commands ────────────────────────────────────────────────────────

#[tauri::command]
fn get_current_window() -> Option<tracker::ActiveWindow> {
    tracker::get_current_window()
}

#[tauri::command]
fn get_today_activities() -> Result<Vec<db::Activity>, String> {
    db::get_today_activities().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_activities_for_date(from_ts: i64, to_ts: i64) -> Result<Vec<db::Activity>, String> {
    db::get_activities_in_range(from_ts, to_ts).map_err(|e| e.to_string())
}

#[tauri::command]
fn assign_activity(activity_id: i64, project_id: i64) -> Result<(), String> {
    db::assign_activity(activity_id, project_id, "manual").map_err(|e| e.to_string())
}

// ─── Activity mutations ─────────────────────────────────────────────────────

#[tauri::command]
fn delete_activity(activity_id: i64) -> Result<(), String> {
    db::delete_activity(activity_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_activity(
    activity_id: i64,
    app_name: String,
    window_title: String,
    started_at: i64,
    ended_at: i64,
) -> Result<(), String> {
    db::update_activity(activity_id, &app_name, &window_title, started_at, ended_at)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn create_manual_activity(
    title: String,
    note: String,
    project_id: Option<i64>,
    started_at: i64,
    duration_s: i64,
) -> Result<(), String> {
    db::create_manual_activity(&title, &note, project_id, started_at, duration_s)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn apply_rule_to_activities(rule_id: i64, from_ts: i64, to_ts: i64) -> Result<i32, String> {
    let rules = db::get_all_rules().map_err(|e| e.to_string())?;
    let rule = rules
        .iter()
        .find(|r| r.id == Some(rule_id))
        .ok_or_else(|| format!("Rule {} not found", rule_id))?;
    let activities = db::get_unassigned_activities_in_range(from_ts, to_ts)
        .map_err(|e| e.to_string())?;
    let mut count = 0i32;
    for activity in &activities {
        let window = tracker::ActiveWindow {
            app_name: activity.app_name.clone(),
            window_title: activity.window_title.clone().unwrap_or_default(),
            url: activity.domain.clone(),
            timestamp: activity.started_at,
        };
        if rules::rule_matches_one(rule, &window) {
            if let Some(id) = activity.id {
                let _ = db::assign_activity(id, rule.project_id, "rule");
                count += 1;
            }
        }
    }
    Ok(count)
}

#[tauri::command]
fn assign_all_unassigned_today(project_id: i64) -> Result<i32, String> {
    db::assign_all_unassigned_today(project_id).map_err(|e| e.to_string())
}

// ─── Project commands ───────────────────────────────────────────────────────

#[tauri::command]
fn get_projects() -> Result<Vec<db::Project>, String> {
    db::get_all_projects().map_err(|e| e.to_string())
}

#[tauri::command]
fn create_project(app: tauri::AppHandle, name: String, color: String) -> Result<i64, String> {
    let id = db::create_project(&name, &color).map_err(|e| e.to_string())?;
    // auto-create rules
    let auto = rules::auto_rules_for_project(&name);
    for (field, op, val) in auto {
        let _ = db::create_rule(id, &field, &op, &val, 0);
    }
    // keep tray in sync
    let _ = tray::rebuild_tray(&app);
    Ok(id)
}

// ─── Rules commands ─────────────────────────────────────────────────────────

#[tauri::command]
fn get_rules() -> Result<Vec<db::Rule>, String> {
    db::get_all_rules().map_err(|e| e.to_string())
}

#[tauri::command]
fn create_rule(project_id: i64, field: String, operator: String, value: String, priority: i32) -> Result<i64, String> {
    db::create_rule(project_id, &field, &operator, &value, priority).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_rules_for_project(project_id: i64) -> Result<Vec<db::Rule>, String> {
    db::get_rules_for_project(project_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_rule(rule_id: i64) -> Result<(), String> {
    db::delete_rule(rule_id).map_err(|e| e.to_string())
}

// ─── Settings commands ──────────────────────────────────────────────────────

#[tauri::command]
fn get_setting(key: String) -> Option<String> {
    db::get_setting(&key)
}

#[tauri::command]
fn set_setting(key: String, value: String) -> Result<(), String> {
    db::set_setting(&key, &value).map_err(|e| e.to_string())
}

// ─── License commands ───────────────────────────────────────────────────────

#[tauri::command]
fn get_license_tier() -> String {
    license::get_effective_tier().as_str().to_string()
}

#[tauri::command]
async fn validate_license(key: String) -> Result<String, String> {
    let tier = license::validate_license_online(&key).await?;
    Ok(tier.as_str().to_string())
}

#[tauri::command]
fn start_trial(email: String, expires_at: i64) -> Result<(), String> {
    db::set_setting("trial_email", &email).map_err(|e| e.to_string())?;
    db::set_setting("trial_started_at", &chrono::Utc::now().timestamp().to_string()).map_err(|e| e.to_string())?;
    db::set_setting("trial_expires_at", &expires_at.to_string()).map_err(|e| e.to_string())?;
    db::set_setting("trial_status", "active").map_err(|e| e.to_string())
}

// ─── Permissions commands ───────────────────────────────────────────────────

#[tauri::command]
fn get_os() -> &'static str {
    permissions::get_os()
}

#[tauri::command]
fn check_accessibility() -> bool {
    permissions::check_accessibility()
}

#[tauri::command]
fn request_accessibility() {
    permissions::request_accessibility()
}

#[tauri::command]
fn check_screen_recording() -> bool {
    permissions::check_screen_recording()
}

#[tauri::command]
fn request_screen_recording() {
    permissions::request_screen_recording()
}

// ─── Tracking lifecycle ──────────────────────────────────────────────────────

#[tauri::command]
fn start_tracking() {
    tracker::start_tracking_loop();
}

// ─── Focus project ──────────────────────────────────────────────────────────

#[tauri::command]
fn get_active_project() -> i64 {
    tracker::ACTIVE_PROJECT_ID.load(std::sync::atomic::Ordering::SeqCst)
}

/// project_id = 0 clears the focus.
#[tauri::command]
fn set_active_project(app: tauri::AppHandle, project_id: i64) -> Result<(), String> {
    tracker::ACTIVE_PROJECT_ID.store(project_id, std::sync::atomic::Ordering::SeqCst);
    db::set_setting("active_project_id", &project_id.to_string()).map_err(|e| e.to_string())?;
    tray::rebuild_tray(&app).map_err(|e| e.to_string())
}

// ─── Tracking pause ──────────────────────────────────────────────────────────

#[tauri::command]
fn get_tracking_paused() -> bool {
    tracker::TRACKING_PAUSED.load(std::sync::atomic::Ordering::SeqCst)
}

#[tauri::command]
fn set_tracking_paused(app: tauri::AppHandle, paused: bool) -> Result<(), String> {
    tracker::TRACKING_PAUSED.store(paused, std::sync::atomic::Ordering::SeqCst);
    db::set_setting("tracking_paused", if paused { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    tray::rebuild_tray(&app).map_err(|e| e.to_string())
}

// ─── Rules override setting ──────────────────────────────────────────────────

#[tauri::command]
fn get_rules_override() -> bool {
    db::get_setting("rules_override_active_project")
        .map(|v| v == "true")
        .unwrap_or(true) // default ON
}

#[tauri::command]
fn set_rules_override(enabled: bool) -> Result<(), String> {
    db::set_setting(
        "rules_override_active_project",
        if enabled { "true" } else { "false" },
    ).map_err(|e| e.to_string())
}

// ─── Notifications ───────────────────────────────────────────────────────────

#[tauri::command]
fn request_notification_permission() -> Result<(), String> {
    db::set_setting("notifications_enabled", "true").map_err(|e| e.to_string())?;
    notify::request_notification_permission();
    Ok(())
}

#[tauri::command]
fn get_notifications_enabled() -> bool {
    db::get_setting("notifications_enabled")
        .map(|v| v == "true")
        .unwrap_or(false)
}

// ─── URL opener ─────────────────────────────────────────────────────────────

#[tauri::command]
fn open_url(url: String) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd").args(["/c", "start", &url]).spawn();
}

// ─── File export ─────────────────────────────────────────────────────────────

#[tauri::command]
fn save_file(content: String, filename: String) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    let dir = {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        format!("{}/Downloads", home)
    };
    #[cfg(target_os = "windows")]
    let dir = {
        let profile = std::env::var("USERPROFILE").map_err(|e| e.to_string())?;
        format!("{}\\Downloads", profile)
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let dir = return Err("Unsupported platform".to_string());

    let path = format!("{}/{}", dir, filename);
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg("-R").arg(&path).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("explorer").args(["/select,", &path]).spawn();
    Ok(path)
}

// ─── App entry ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // ── Restore persisted state into atomics ────────────────────
            let active_pid = db::get_setting("active_project_id")
                .and_then(|v| v.parse::<i64>().ok())
                .unwrap_or(0);
            tracker::ACTIVE_PROJECT_ID
                .store(active_pid, std::sync::atomic::Ordering::SeqCst);

            let paused = db::get_setting("tracking_paused")
                .map(|v| v == "true")
                .unwrap_or(false);
            tracker::TRACKING_PAUSED
                .store(paused, std::sync::atomic::Ordering::SeqCst);

            // ── Hide window on close instead of quitting ─────────────────
            if let Some(window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(w) = handle.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                });
            }

            // ── Set up menu bar tray ─────────────────────────────────────
            tray::setup_tray(app.handle())?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_current_window,
            get_today_activities,
            get_activities_for_date,
            assign_activity,
            delete_activity,
            update_activity,
            create_manual_activity,
            apply_rule_to_activities,
            assign_all_unassigned_today,
            get_projects,
            create_project,
            get_rules,
            create_rule,
            get_rules_for_project,
            delete_rule,
            get_setting,
            set_setting,
            get_license_tier,
            validate_license,
            start_trial,
            get_os,
            check_accessibility,
            request_accessibility,
            check_screen_recording,
            request_screen_recording,
            start_tracking,
            open_url,
            get_active_project,
            set_active_project,
            get_tracking_paused,
            set_tracking_paused,
            get_rules_override,
            set_rules_override,
            request_notification_permission,
            get_notifications_enabled,
            save_file,
            get_tracker_log,
            get_tracker_log_path,
            clear_tracker_log,
            get_idle_threshold,
            set_idle_threshold,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app_handle, event);
        });
}

