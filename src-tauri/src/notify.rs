/// Send a macOS/Windows system notification.
pub fn send_notification(title: &str, body: &str) {
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = (title, body);

    #[cfg(target_os = "macos")]
    {
        let safe_body = body.replace('\\', "\\\\").replace('"', "\\\"");
        let safe_title = title.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            r#"display notification "{}" with title "{}" sound name "default""#,
            safe_body, safe_title,
        );
        let _ = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .spawn();
    }
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        // The XML is embedded in a single-quoted PowerShell string. Escaping
        // XML metacharacters (including apostrophes) keeps notification text
        // from becoming executable PowerShell or malformed toast markup.
        let safe_title = escape_xml_text(title);
        let safe_body = escape_xml_text(body);
        let script = format!(
            r#"$xml = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime]::new()
$xml.LoadXml('<toast><visual><binding template="ToastText02"><text id="1">{}</text><text id="2">{}</text></binding></visual></toast>')
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]::CreateToastNotifier('Duskry').Show([Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType=WindowsRuntime]::new($xml))"#,
            safe_title, safe_body,
        );
        use std::os::windows::process::CommandExt;

        let _ = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &script,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
}

#[cfg(any(target_os = "windows", test))]
fn escape_xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
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
    use chrono::Timelike;

    let now = chrono::Local::now();
    if now.hour() < 6 {
        return false;
    }
    let today = now.format("%Y-%m-%d").to_string();
    let last = crate::db::get_setting("last_notification_date").unwrap_or_default();
    last != today
}

/// Mark today's daily notification as sent.
pub fn mark_notification_sent() {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let _ = crate::db::set_setting("last_notification_date", &today);
}

#[cfg(test)]
mod tests {
    use super::{escape_xml_text, valid_update_version};

    #[test]
    fn escapes_notification_text_before_embedding_it_in_powershell() {
        assert_eq!(
            escape_xml_text("Duskry's <update> & \"restart\""),
            "Duskry&apos;s &lt;update&gt; &amp; &quot;restart&quot;"
        );
    }

    #[test]
    fn accepts_versions_but_rejects_script_or_markup_input() {
        assert!(valid_update_version("1.2.3-beta+4"));
        assert!(!valid_update_version(""));
        assert!(!valid_update_version("1.2.3'; Start-Process calc; '"));
        assert!(!valid_update_version("<toast>"));
    }
}
