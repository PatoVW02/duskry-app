pub fn get_os() -> &'static str {
    #[cfg(target_os = "macos")]
    return "macos";
    #[cfg(target_os = "windows")]
    return "windows";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return "unknown";
}

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    /// Returns true if this process has been granted Accessibility permission.
    /// This is the canonical API — accurate and instant, no subprocess needed.
    fn AXIsProcessTrusted() -> bool;
}

#[cfg(target_os = "macos")]
pub fn check_accessibility() -> bool {
    unsafe { AXIsProcessTrusted() }
}

#[cfg(not(target_os = "macos"))]
pub fn check_accessibility() -> bool {
    true
}

pub fn request_accessibility() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
    }
}

// ── CoreGraphics screen capture APIs (macOS 10.15+) ──────────────────────────
#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    /// Returns true if this process already has screen capture permission.
    /// Does NOT prompt the user.
    fn CGPreflightScreenCaptureAccess() -> bool;
    /// Requests screen capture permission. On macOS 13+ this opens System Settings
    /// and adds the app to the Screen Recording list. Returns true if granted.
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// Check screen recording permission using the official CoreGraphics API.
/// Works correctly with SIP enabled — no TCC database access needed.
#[cfg(target_os = "macos")]
pub fn check_screen_recording() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}

#[cfg(not(target_os = "macos"))]
pub fn check_screen_recording() -> bool {
    true
}

/// Request screen recording permission via CGRequestScreenCaptureAccess().
/// This automatically adds the app to the Screen Recording list in System Settings.
/// Always opens System Settings afterwards so the user can toggle it on.
pub fn request_screen_recording() {
    #[cfg(target_os = "macos")]
    {
        // Register the app in the Screen Recording list. Ignore the return value —
        // even if it returns false (already denied / needs toggle), we still open
        // System Settings so the user can turn it on.
        let _ = unsafe { CGRequestScreenCaptureAccess() };

        // Always navigate to the Screen Recording pane.
        // Try the macOS 13+ URL first; if that fails, fall back to the legacy URL.
        let opened = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture")
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if !opened {
            let _ = std::process::Command::new("open")
                .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
                .spawn();
        }
    }
}

pub fn check_notifications() -> bool {
    crate::db::get_setting("notifications_enabled")
        .map(|v| v == "true")
        .unwrap_or(false)
}
