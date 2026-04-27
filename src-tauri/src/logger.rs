use chrono::Local;
use once_cell::sync::Lazy;
/// Simple append-only tracker log.
///
/// Log file location: `{data_dir}/duskry[-dev]/tracker.log`
/// The file is automatically trimmed to the last 2 000 lines when it exceeds 200 KB
/// so it never grows unboundedly.
///
/// Call `tlog("message")` from anywhere — no initialisation required.
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

const MAX_BYTES: u64 = 200_000;
const KEEP_LINES: usize = 2_000;

fn log_path() -> PathBuf {
    static PATH: Lazy<PathBuf> = Lazy::new(|| {
        crate::paths::app_data_file("tracker.log")
    });
    PATH.clone()
}

/// Write a timestamped line to the tracker log.
pub fn tlog(msg: &str) {
    let path = log_path();
    let ts = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{}] {}\n", ts, msg);

    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(line.as_bytes());
    }

    // Lazy rotation — only when the file is large enough
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_BYTES {
            rotate(&path);
        }
    }
}

fn rotate(path: &std::path::Path) {
    let Ok(content) = std::fs::read_to_string(path) else {
        return;
    };
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() > KEEP_LINES {
        let trimmed = lines[lines.len() - KEEP_LINES..].join("\n") + "\n";
        let _ = std::fs::write(path, trimmed.as_bytes());
    }
}

/// Return the last `n` lines of the log (most recent at the end).
pub fn get_log_lines(n: usize) -> Vec<String> {
    let path = log_path();
    let Ok(content) = std::fs::read_to_string(&path) else {
        return vec![];
    };
    let all: Vec<&str> = content.lines().collect();
    let start = all.len().saturating_sub(n);
    all[start..].iter().map(|s| s.to_string()).collect()
}

/// Absolute path of the log file (so the user can open it externally).
pub fn log_path_str() -> String {
    log_path().to_string_lossy().into_owned()
}

/// Delete the log file contents (keep the file).
pub fn clear_log() {
    let path = log_path();
    let _ = std::fs::write(&path, b"");
}
