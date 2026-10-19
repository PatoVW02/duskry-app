use std::hash::{Hash, Hasher};
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};
use tauri_plugin_notification::{Action, ActionType, NotificationExt};

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static POLICY: Mutex<SessionPolicy> = Mutex::new(SessionPolicy::new());
static OPEN_ACTIVITY: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    APP.set(app.clone())
        .map_err(|_| "Notifications already initialized".to_string())?;
    app.notification()
        .register_action_types(vec![ActionType::builder("tracking")
            .actions(vec![Action::builder("review", "Review assignment").build()])
            .build()])
        .map_err(|error| error.to_string())?;
    let handle = app.clone();
    app.notification()
        .on_action(move |action| {
            if !matches!(action.action_id(), "tap" | "review") {
                return;
            }
            let activity_id = action
                .notification()
                .and_then(|notice| notice.extra().get("activity_id"))
                .and_then(serde_json::Value::as_i64);
            if let Some(activity_id) = activity_id {
                OPEN_ACTIVITY.store(activity_id, std::sync::atomic::Ordering::SeqCst);
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
                let _ = handle.emit("tracking-notice-open", activity_id);
            }
        })
        .map_err(|error| error.to_string())
}

pub fn take_open_activity() -> i64 {
    OPEN_ACTIVITY.swap(0, std::sync::atomic::Ordering::SeqCst)
}

pub fn send_notification(title: &str, body: &str) {
    if let Some(app) = APP.get() {
        if let Err(error) = app.notification().builder().title(title).body(body).show() {
            crate::logger::tlog(&format!("Notification failed: {error}"));
        }
    }
}

#[derive(Default)]
struct SessionPolicy {
    candidate: Option<(i64, i64)>,
    since: i64,
    last_sent: Option<((i64, i64), i64)>,
    notified: bool,
}

impl SessionPolicy {
    const fn new() -> Self {
        Self {
            candidate: None,
            since: 0,
            last_sent: None,
            notified: false,
        }
    }
    fn ready(&mut self, key: (i64, i64), now: i64) -> bool {
        if self.candidate != Some(key) {
            self.candidate = Some(key);
            self.since = now;
            self.notified = false;
            return false;
        }
        if self.notified || now - self.since < 20 {
            return false;
        }
        if let Some((_, sent_at)) = self.last_sent {
            if now - sent_at < 60 {
                return false;
            }
        }
        true
    }
    fn sent(&mut self, key: (i64, i64), now: i64) {
        self.last_sent = Some((key, now));
        self.notified = true;
    }
    fn reset(&mut self) {
        self.candidate = None;
        self.notified = false;
    }
}

pub fn reset_session() {
    if let Ok(mut policy) = POLICY.lock() {
        policy.reset();
    }
}

pub fn observe(activity: &crate::db::Activity, prediction: Option<&crate::automation::Prediction>) {
    let mode =
        crate::db::get_setting("tracking_notification_mode").unwrap_or_else(|| "sessions".into());
    let uncertain =
        activity.project_id.is_none() || activity.source.as_deref() == Some("best_guess");
    let Some(activity_id) = activity.id else {
        return;
    };
    let suggested = prediction.map(|p| p.project_id);
    let key = (
        activity.project_id.unwrap_or(0),
        if uncertain {
            let mut context = std::collections::hash_map::DefaultHasher::new();
            (
                &activity.app_name,
                &activity.window_title,
                &activity.domain,
                &activity.file_path,
                suggested,
            )
                .hash(&mut context);
            context.finish() as i64
        } else {
            0
        },
    );
    let now = chrono::Utc::now().timestamp();
    let ready = POLICY
        .lock()
        .map(|mut policy| policy.ready(key, now))
        .unwrap_or(false);
    if !ready || mode == "off" || (mode == "uncertain" && !uncertain) {
        return;
    }
    let confidence = prediction
        .map(|p| p.confidence)
        .or(activity.assignment_confidence);
    let reason = if uncertain {
        "Please confirm the project for this session."
    } else {
        "A new project session is being tracked."
    };
    if let Err(error) = crate::db::save_tracking_notice(activity_id, suggested, confidence, reason)
    {
        crate::logger::tlog(&format!("Could not save tracking notice: {error}"));
        return;
    }
    if let Ok(mut policy) = POLICY.lock() {
        policy.sent(key, now);
    }
    let Some(app) = APP.get() else {
        return;
    };
    let _ = app.emit("tracking-notices-changed", ());
    if crate::db::get_setting("notifications_enabled").as_deref() != Some("true") {
        return;
    }
    let project_name = activity.project_id.or(suggested).and_then(|project_id| {
        crate::db::get_all_projects()
            .ok()?
            .into_iter()
            .find(|p| p.id == Some(project_id))
            .map(|p| p.name)
    });
    let title = match (uncertain, project_name) {
        (false, Some(name)) => format!("Tracking {name}"),
        (true, Some(name)) => format!("Is this work for {name}?"),
        _ => "Which project is this work for?".into(),
    };
    if let Err(error) = app
        .notification()
        .builder()
        .title(title)
        .body(format!(
            "{} · Review or correct this assignment in Duskry.",
            activity.app_name
        ))
        .action_type_id("tracking")
        .extra("activity_id", activity_id)
        .show()
    {
        crate::logger::tlog(&format!("Tracking notification failed: {error}"));
    }
}

pub fn valid_update_version(version: &str) -> bool {
    let version = version.trim();
    !version.is_empty()
        && version.len() <= 32
        && version.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '+')
        })
}

/// Trigger the OS notification permission dialog (macOS shows it on first notification send).
pub fn request_notification_permission() {
    send_notification("Duskry", "Tracking notifications are now enabled.");
}

#[cfg(test)]
mod tests {
    use super::{valid_update_version, SessionPolicy};

    #[test]
    fn session_alerts_wait_for_stability_and_do_not_follow_every_window_switch() {
        let mut policy = SessionPolicy::new();
        assert!(!policy.ready((1, 0), 100));
        assert!(!policy.ready((1, 0), 115));
        assert!(policy.ready((1, 0), 120));
        policy.sent((1, 0), 120);
        assert!(!policy.ready((1, 0), 300));
        assert!(!policy.ready((2, 0), 130));
        assert!(!policy.ready((2, 0), 150));
        assert!(policy.ready((2, 0), 180));
    }

    #[test]
    fn quick_switches_restart_the_stability_window() {
        let mut policy = SessionPolicy::new();
        assert!(!policy.ready((1, 0), 100));
        assert!(!policy.ready((2, 0), 110));
        assert!(!policy.ready((1, 0), 120));
        assert!(!policy.ready((1, 0), 135));
        assert!(policy.ready((1, 0), 140));
    }

    #[test]
    fn a_resumed_session_can_alert_again_without_bypassing_the_global_cooldown() {
        let mut policy = SessionPolicy::new();
        assert!(!policy.ready((1, 0), 100));
        policy.sent((1, 0), 120);
        policy.reset();
        assert!(!policy.ready((1, 0), 130));
        assert!(!policy.ready((1, 0), 150));
        assert!(policy.ready((1, 0), 180));
    }

    #[test]
    fn accepts_versions_but_rejects_script_or_markup_input() {
        assert!(valid_update_version("1.2.3-beta+4"));
        assert!(!valid_update_version(""));
        assert!(!valid_update_version("1.2.3'; Start-Process calc; '"));
        assert!(!valid_update_version("<toast>"));
    }
}
