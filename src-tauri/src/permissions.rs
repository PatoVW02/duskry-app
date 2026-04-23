pub fn get_os() -> &'static str {
    #[cfg(target_os = "macos")]
    return "macos";
    #[cfg(target_os = "windows")]
    return "windows";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return "unknown";
}

#[cfg(target_os = "macos")]
pub fn check_accessibility() -> bool {
    use std::process::Command;
    // AXIsProcessTrusted is available without linking extra libs via a shell helper
    let out = Command::new("osascript")
        .arg("-e")
        .arg(r#"tell application "System Events" to return (count of (every process whose frontmost is true)) >= 0"#)
        .output();
    match out {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
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

pub fn request_screen_recording() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn();
    }
}
