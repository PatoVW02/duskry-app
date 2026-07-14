mod db;
pub(crate) mod feature_flags;
mod license;
mod logger;
mod notify;
mod paths;
mod permissions;
mod rules;
mod tracker;
mod tray;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

static REAL_QUIT_REQUESTED: AtomicBool = AtomicBool::new(false);

fn current_local_day_key() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn refresh_active_project_state() -> i64 {
    let active_pid = db::get_setting("active_project_id")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    if active_pid <= 0 {
        tracker::ACTIVE_PROJECT_ID.store(0, std::sync::atomic::Ordering::SeqCst);
        return 0;
    }

    let stored_day = db::get_setting("active_project_date").unwrap_or_default();
    if stored_day == current_local_day_key() {
        tracker::ACTIVE_PROJECT_ID.store(active_pid, std::sync::atomic::Ordering::SeqCst);
        return active_pid;
    }

    tracker::ACTIVE_PROJECT_ID.store(0, std::sync::atomic::Ordering::SeqCst);
    let _ = db::set_setting("active_project_id", "0");
    let _ = db::set_setting("active_project_date", "");
    0
}

fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

pub(crate) fn request_real_quit(app: &tauri::AppHandle) {
    REAL_QUIT_REQUESTED.store(true, Ordering::SeqCst);
    app.exit(0);
}

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
fn assign_activity(
    activity_id: i64,
    project_id: i64,
) -> Result<Option<db::RuleSuggestion>, String> {
    Ok(assign_activities_internal(vec![activity_id], project_id)?
        .into_iter()
        .next())
}

#[tauri::command]
fn assign_activities(
    activity_ids: Vec<i64>,
    project_id: i64,
) -> Result<Vec<db::RuleSuggestion>, String> {
    assign_activities_internal(activity_ids, project_id)
}

fn assign_activities_internal(
    mut activity_ids: Vec<i64>,
    project_id: i64,
) -> Result<Vec<db::RuleSuggestion>, String> {
    let mut seen = std::collections::HashSet::new();
    activity_ids.retain(|activity_id| *activity_id > 0 && seen.insert(*activity_id));
    if activity_ids.is_empty() {
        return Ok(Vec::new());
    }

    let previous: Vec<db::Activity> = activity_ids
        .iter()
        .map(|activity_id| db::get_activity(*activity_id).map_err(|error| error.to_string()))
        .collect::<Result<_, _>>()?;
    db::assign_activities(&activity_ids, project_id, "manual").map_err(|e| e.to_string())?;

    let learned: Vec<db::Activity> = previous
        .into_iter()
        .filter(|activity| activity.project_id != Some(project_id))
        .collect();
    if !learned.is_empty() {
        // Corrections must update existing learned-rule confidence even when
        // new suggestions are disabled or the feature is not entitled.
        db::record_assignment_learning_batch(&learned, project_id).map_err(|e| e.to_string())?;
        refresh_learned_rules()?;
    }

    let tier = license::get_effective_tier();
    let rule_suggestions_locked = feature_flags::billing_plans_enabled()
        && (tier == license::AppTier::Free || tier == license::AppTier::Expired);
    if rule_suggestions_locked {
        return Ok(Vec::new());
    }

    let suggestions_enabled = db::get_setting("auto_rule_suggestions_enabled")
        .map(|v| v == "true")
        .unwrap_or(true);
    let auto_create = db::get_setting("auto_create_suggested_rules_enabled")
        .map(|v| v == "true")
        .unwrap_or(false);
    if !suggestions_enabled && !auto_create {
        return Ok(Vec::new());
    }

    if learned.is_empty() {
        return Ok(Vec::new());
    }

    // A batch is one learning action: analyze it once using the most recent
    // corrected activity as the representative signal. This avoids N complete
    // evidence scans and, importantly, cannot return the same notice N times.
    let representative_id = learned
        .iter()
        .max_by_key(|activity| activity.started_at)
        .and_then(|activity| activity.id)
        .ok_or_else(|| "Assigned activity has no ID.".to_string())?;
    let suggestion = db::get_rule_suggestion_for_activity(representative_id, auto_create)
        .map_err(|e| e.to_string())?;

    if auto_create {
        if let Some(mut s) = suggestion {
            let value = suggested_rule_value(&s.field, &s.operator, &s.value);
            let (field, operator) = suggested_rule_storage(&s.field, &s.operator);
            rules::validate_rule(field, operator, &value)?;
            let rule_id = db::create_rule_with_metadata(
                s.project_id,
                field,
                operator,
                &value,
                db::RuleMetadata {
                    priority: 0,
                    source: "learned",
                    enabled: true,
                    confidence: Some(s.confidence),
                    support_count: s.count,
                },
            )
            .map_err(|e| e.to_string())?;
            db::mark_rule_suggestion_created(s.project_id, &s.field, &s.operator, &s.value)
                .map_err(|e| e.to_string())?;
            s.auto_created = true;
            s.rule_id = Some(rule_id);
            return Ok(vec![s]);
        }
        return Ok(Vec::new());
    }

    Ok(suggestion.into_iter().collect())
}

#[tauri::command]
fn unassign_activity(activity_id: i64) -> Result<(), String> {
    let previous = db::get_activity(activity_id).map_err(|e| e.to_string())?;
    if previous.source.as_deref() == Some("learned_rule") {
        pause_matching_learned_rules(&previous)?;
    }
    db::unassign_activity(activity_id).map_err(|e| e.to_string())?;
    db::remove_assignment_learning(activity_id).map_err(|e| e.to_string())?;
    refresh_learned_rules()
}

// ─── Activity mutations ─────────────────────────────────────────────────────

#[tauri::command]
fn delete_activity(activity_id: i64) -> Result<(), String> {
    db::delete_activity(activity_id).map_err(|e| e.to_string())?;
    refresh_learned_rules()
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
        .map_err(|e| e.to_string())?;
    refresh_learned_rules()
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
    let activities =
        db::get_unassigned_activities_in_range(from_ts, to_ts).map_err(|e| e.to_string())?;
    let mut count = 0i32;
    for activity in &activities {
        let window = tracker::ActiveWindow {
            app_name: activity.app_name.clone(),
            window_title: activity.window_title.clone().unwrap_or_default(),
            url: activity.domain.clone(),
            file_path: activity.file_path.clone(),
            timestamp: activity.started_at,
        };
        if rules::rule_matches_one(rule, &window) {
            if let Some(id) = activity.id {
                let learned = rule.source == "learned";
                let source = if learned {
                    "learned_rule"
                } else {
                    "manual_rule"
                };
                let confidence = rule.confidence.or((!learned).then_some(1.0));
                let reason = format!(
                    "retroactive {} rule{}",
                    if learned { "learned" } else { "manual" },
                    rule.id
                        .map(|rule_id| format!(" #{rule_id}"))
                        .unwrap_or_default()
                );
                db::assign_activity_with_decision(
                    id,
                    rule.project_id,
                    source,
                    rule.id,
                    confidence,
                    Some(&reason),
                )
                .map_err(|error| error.to_string())?;
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
    let tier = license::get_effective_tier();
    if feature_flags::billing_plans_enabled()
        && (tier == license::AppTier::Free || tier == license::AppTier::Expired)
    {
        let count = db::count_projects().map_err(|e| e.to_string())?;
        if count >= 3 {
            return Err(
                "Project limit reached. Upgrade to Pro for unlimited projects.".to_string(),
            );
        }
    }
    let id = db::create_project(&name, &color).map_err(|e| e.to_string())?;
    // keep tray in sync
    let _ = tray::rebuild_tray(&app);
    Ok(id)
}

#[tauri::command]
fn delete_project(app: tauri::AppHandle, project_id: i64) -> Result<(), String> {
    if db::get_setting("active_project_id").and_then(|v| v.parse::<i64>().ok()) == Some(project_id)
    {
        tracker::ACTIVE_PROJECT_ID.store(0, std::sync::atomic::Ordering::SeqCst);
        db::set_setting("active_project_id", "0").map_err(|e| e.to_string())?;
        db::set_setting("active_project_date", "").map_err(|e| e.to_string())?;
    }
    db::delete_project(project_id).map_err(|e| e.to_string())?;
    refresh_learned_rules()?;
    let _ = tray::rebuild_tray(&app);
    Ok(())
}

// ─── Rules commands ─────────────────────────────────────────────────────────

#[tauri::command]
fn get_rules() -> Result<Vec<db::Rule>, String> {
    db::get_all_rules().map_err(|e| e.to_string())
}

#[tauri::command]
fn create_rule(
    project_id: i64,
    field: String,
    operator: String,
    value: String,
    priority: i32,
) -> Result<i64, String> {
    let tier = license::get_effective_tier();
    if feature_flags::billing_plans_enabled()
        && (tier == license::AppTier::Free || tier == license::AppTier::Expired)
    {
        return Err("Upgrade to Pro to create rules.".to_string());
    }
    rules::validate_rule(&field, &operator, &value)?;
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

#[tauri::command]
fn set_rule_enabled(rule_id: i64, enabled: bool) -> Result<(), String> {
    db::set_rule_enabled(rule_id, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_suggested_rule(
    project_id: i64,
    field: String,
    operator: String,
    value: String,
) -> Result<i64, String> {
    let tier = license::get_effective_tier();
    if feature_flags::billing_plans_enabled()
        && (tier == license::AppTier::Free || tier == license::AppTier::Expired)
    {
        return Err("Upgrade to Pro to create suggested rules.".to_string());
    }

    let compound_value = suggested_rule_value(&field, &operator, &value);
    let (stored_field, stored_operator) = suggested_rule_storage(&field, &operator);
    rules::validate_rule(stored_field, stored_operator, &compound_value)?;
    let rule_id = db::create_rule(
        project_id,
        stored_field,
        stored_operator,
        &compound_value,
        0,
    )
    .map_err(|e| e.to_string())?;
    db::mark_rule_suggestion_created(project_id, &field, &operator, &value)
        .map_err(|e| e.to_string())?;
    Ok(rule_id)
}

fn suggested_rule_value(field: &str, operator: &str, value: &str) -> String {
    if field == "compound" {
        return value.to_string();
    }
    serde_json::json!({
        "combinator": "and",
        "conditions": [{
            "field": field,
            "operator": operator,
            "value": value,
            "negated": false
        }]
    })
    .to_string()
}

fn suggested_rule_storage<'a>(field: &'a str, operator: &'a str) -> (&'a str, &'a str) {
    if field == "compound" {
        (field, operator)
    } else {
        ("compound", "matches")
    }
}

#[tauri::command]
fn dismiss_rule_suggestion(
    project_id: i64,
    field: String,
    operator: String,
    value: String,
) -> Result<(), String> {
    db::dismiss_rule_suggestion(project_id, &field, &operator, &value).map_err(|e| e.to_string())
}

#[tauri::command]
fn mark_rule_suggestion_prompted(
    project_id: i64,
    field: String,
    operator: String,
    value: String,
) -> Result<(), String> {
    db::mark_rule_suggestion_prompted(project_id, &field, &operator, &value)
        .map_err(|e| e.to_string())
}

fn activity_window(activity: &db::Activity) -> tracker::ActiveWindow {
    tracker::ActiveWindow {
        app_name: activity.app_name.clone(),
        window_title: activity.window_title.clone().unwrap_or_default(),
        url: activity.domain.clone(),
        file_path: activity.file_path.clone(),
        timestamp: activity.started_at,
    }
}

fn learning_event_window(event: &db::LearningEvent) -> tracker::ActiveWindow {
    tracker::ActiveWindow {
        app_name: event.app_name.clone(),
        window_title: event.window_title.clone().unwrap_or_default(),
        url: event.domain.clone(),
        file_path: event.file_path.clone(),
        timestamp: event.started_at,
    }
}

fn pause_matching_learned_rules(activity: &db::Activity) -> Result<(), String> {
    let Some(project_id) = activity.project_id else {
        return Ok(());
    };
    let window = activity_window(activity);
    for mut rule in db::get_all_rules().map_err(|e| e.to_string())? {
        if rule.source != "learned" || rule.project_id != project_id {
            continue;
        }
        rule.enabled = true;
        if rules::rule_matches_one(&rule, &window) {
            if let Some(rule_id) = rule.id {
                db::set_rule_enabled(rule_id, false).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Recompute learned-rule precision from the corrected assignment history.
/// Signals are derived rather than incremented, so moving A → B cannot leave
/// stale positive evidence for A. Two or more meaningful corrections will
/// normally take a 5-example learned rule below the 80% safety floor and pause it.
fn refresh_learned_rules() -> Result<(), String> {
    let events = db::get_learning_events().map_err(|e| e.to_string())?;
    for mut rule in db::get_all_rules().map_err(|e| e.to_string())? {
        if rule.source != "learned" {
            continue;
        }
        rule.enabled = true;
        let mut total = 0_i64;
        let mut support = 0_i64;
        for event in &events {
            if rules::rule_matches_one(&rule, &learning_event_window(event)) {
                total += 1;
                if event.project_id == rule.project_id {
                    support += 1;
                }
            }
        }
        let confidence = if total > 0 {
            support as f64 / total as f64
        } else {
            0.0
        };
        let keep_enabled = support >= 3 && confidence >= 0.80;
        if let Some(rule_id) = rule.id {
            db::update_learned_rule_stats(rule_id, confidence, support, keep_enabled)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
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

#[tauri::command]
fn set_rule_automation_mode(mode: String) -> Result<(), String> {
    if !matches!(mode.as_str(), "off" | "suggest" | "automatic") {
        return Err("Invalid rule automation mode.".to_string());
    }
    db::set_rule_automation_mode(&mode).map_err(|error| error.to_string())
}

// ─── License commands ───────────────────────────────────────────────────────

#[tauri::command]
fn get_license_tier() -> String {
    license::get_effective_tier().as_str().to_string()
}

#[tauri::command]
fn get_license_status() -> license::LicenseStatus {
    license::get_license_status()
}

#[tauri::command]
async fn refresh_license_tier() -> Result<String, String> {
    let tier = license::refresh_license_online().await?;
    Ok(tier.as_str().to_string())
}

#[tauri::command]
async fn refresh_license_status() -> license::LicenseStatus {
    license::refresh_license_status().await
}

#[tauri::command]
async fn validate_license(key: String) -> Result<String, String> {
    let tier = license::validate_license_online(&key).await?;
    Ok(tier.as_str().to_string())
}

#[tauri::command]
fn can_deactivate_license() -> bool {
    license::cached_license_can_deactivate()
}

#[tauri::command]
async fn remove_license() -> Result<String, String> {
    let tier = license::remove_license_online().await?;
    Ok(tier.as_str().to_string())
}

#[tauri::command]
fn start_trial(email: String) -> Result<i64, String> {
    let already_started = db::get_setting("trial_started_at")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0)
        > 0;
    if already_started {
        return Err("A free trial has already been used on this computer.".to_string());
    }

    db::set_setting("trial_email", &email).map_err(|e| e.to_string())?;
    let started_at = chrono::Utc::now().timestamp();
    let expires_at = started_at + 7 * 24 * 60 * 60;
    db::set_setting("trial_started_at", &started_at.to_string()).map_err(|e| e.to_string())?;
    db::set_setting("trial_expires_at", &expires_at.to_string()).map_err(|e| e.to_string())?;
    db::set_setting("trial_status", "active").map_err(|e| e.to_string())?;
    Ok(expires_at)
}

#[tauri::command]
fn cancel_trial() -> Result<(), String> {
    // Cancelling the trial switches to the permanent Free plan. It should not
    // route the user into the expired-trial paywall.
    db::set_setting("trial_status", "downgraded").map_err(|e| e.to_string())
}

#[tauri::command]
fn downgrade_to_free() -> Result<(), String> {
    // "downgraded" is not matched by any paid/expired case → get_effective_tier() returns Free
    db::set_setting("trial_status", "downgraded").map_err(|e| e.to_string())
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
    refresh_active_project_state()
}

/// project_id = 0 clears the focus.
#[tauri::command]
fn set_active_project(app: tauri::AppHandle, project_id: i64) -> Result<(), String> {
    tracker::ACTIVE_PROJECT_ID.store(project_id, std::sync::atomic::Ordering::SeqCst);
    db::set_setting("active_project_id", &project_id.to_string()).map_err(|e| e.to_string())?;
    let active_project_date = if project_id > 0 {
        current_local_day_key()
    } else {
        String::new()
    };
    db::set_setting("active_project_date", &active_project_date).map_err(|e| e.to_string())?;
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
    )
    .map_err(|e| e.to_string())
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
fn open_url(url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("Only http and https URLs can be opened".to_string());
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── File export ─────────────────────────────────────────────────────────────

#[tauri::command]
fn save_file(content: String, filename: String) -> Result<String, String> {
    let filename = filename.trim();
    if filename.is_empty()
        || filename == "."
        || filename == ".."
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
    {
        return Err("Invalid export filename".to_string());
    }

    let dir = dirs::download_dir().ok_or_else(|| "Downloads folder is unavailable".to_string())?;
    let path = dir.join(filename);
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("explorer")
        .arg("/select,")
        .arg(&path)
        .spawn();
    Ok(path.to_string_lossy().into_owned())
}

// ─── App entry ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // ── Restore persisted state into atomics ────────────────────
            refresh_active_project_state();

            let paused = db::get_setting("tracking_paused")
                .map(|v| v == "true")
                .unwrap_or(false);
            tracker::TRACKING_PAUSED.store(paused, std::sync::atomic::Ordering::SeqCst);

            let onboarding_complete = db::get_setting("onboarding_complete")
                .map(|v| v == "true")
                .unwrap_or(false);
            if onboarding_complete {
                logger::tlog("Backend setup: onboarding complete; starting tracker watchdog");
                tracker::start_tracking_loop();
            } else {
                logger::tlog("Backend setup: onboarding incomplete; tracker watchdog not started");
            }

            // ── Hide window on close instead of quitting ─────────────────
            if let Some(window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        hide_main_window(&handle);
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
            assign_activities,
            unassign_activity,
            delete_activity,
            update_activity,
            create_manual_activity,
            apply_rule_to_activities,
            assign_all_unassigned_today,
            get_projects,
            create_project,
            delete_project,
            get_rules,
            create_rule,
            get_rules_for_project,
            delete_rule,
            set_rule_enabled,
            create_suggested_rule,
            dismiss_rule_suggestion,
            mark_rule_suggestion_prompted,
            get_setting,
            set_setting,
            set_rule_automation_mode,
            get_license_tier,
            get_license_status,
            refresh_license_tier,
            refresh_license_status,
            validate_license,
            can_deactivate_license,
            remove_license,
            start_trial,
            cancel_trial,
            downgrade_to_free,
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
        .run(|app_handle, event| match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                if !REAL_QUIT_REQUESTED.swap(false, Ordering::SeqCst) {
                    api.prevent_exit();
                    hide_main_window(app_handle);
                }
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        });
}
