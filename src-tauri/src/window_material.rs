#[cfg(any(target_os = "windows", test))]
const WINDOWS_MICA_MIN_BUILD: u32 = 22_000;

#[cfg(any(target_os = "windows", test))]
fn windows_build_supports_mica(build: Option<u32>) -> bool {
    matches!(build, Some(build) if build >= WINDOWS_MICA_MIN_BUILD)
}

#[cfg(target_os = "windows")]
fn current_windows_build() -> Option<u32> {
    use windows::Wdk::System::SystemServices::RtlGetVersion;
    use windows::Win32::System::SystemInformation::OSVERSIONINFOW;

    let mut info = OSVERSIONINFOW {
        dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOW>() as u32,
        ..Default::default()
    };
    let status = unsafe { RtlGetVersion(&mut info) };
    status.is_ok().then_some(info.dwBuildNumber)
}

pub fn current_mode() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "native"
    }

    #[cfg(target_os = "windows")]
    {
        if windows_build_supports_mica(current_windows_build()) {
            "native"
        } else {
            "solid"
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "solid"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mica_requires_windows_11_build() {
        assert!(!windows_build_supports_mica(None));
        assert!(!windows_build_supports_mica(Some(19_045)));
        assert!(!windows_build_supports_mica(Some(21_999)));
        assert!(windows_build_supports_mica(Some(22_000)));
        assert!(windows_build_supports_mica(Some(26_100)));
    }
}
