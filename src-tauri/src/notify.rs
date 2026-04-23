/// Send a macOS/Windows system notification.
pub fn send_notification(title: &str, body: &str) {
    #[cfg(target_os = "macos")]
    {
        let safe_body  = body.replace('\\', "\\\\").replace('"', "\\\"");
        let safe_title = title.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            r#"display notification "{}" with title "{}" sound name "default""#,
            safe_body, safe_title,
        );
        let _ = std::process::Command::new("osascript")
            .arg("-e").arg(&script)
            .spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let script = format!(
            r#"$xml = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime]::new()
$xml.LoadXml('<toast><visual><binding template="ToastText02"><text id="1">{}</text><text id="2">{}</text></binding></visual></toast>')
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]::CreateToastNotifier('Duskry').Show([Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType=WindowsRuntime]::new($xml))"#,
            title, body,
        );
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .spawn();
    }
}

/// Trigger the OS notification permission dialog (macOS shows it on first notification send).
pub fn request_notification_permission() {
    send_notification("Duskry", "Morning reminders are now enabled.");
}

/// Send the daily "what are you working on?" focus prompt.
pub fn send_focus_notification() {
    send_notification(
        "Good morning — what are you working on?",
        "Open Duskry to set your focus project for today.",
    );
}

/// Returns true if today's daily notification hasn't been sent yet.
pub fn should_send_daily_notification() -> bool {
    // Only send if the user has explicitly enabled notifications
    let enabled = crate::db::get_setting("notifications_enabled")
        .map(|v| v == "true")
        .unwrap_or(false);
    if !enabled {
        return false;
    }
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let last = crate::db::get_setting("last_notification_date").unwrap_or_default();
    last != today
}

/// Mark today's daily notification as sent.
pub fn mark_notification_sent() {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let _ = crate::db::set_setting("last_notification_date", &today);
}
