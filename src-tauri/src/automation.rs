use crate::{db, rules, tracker::ActiveWindow};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Prediction {
    pub project_id: i64,
    pub confidence: f64,
}

/// Use only human-labelled evidence. Tracker output must never train itself.
pub fn predict(window: &ActiveWindow, events: &[db::LearningEvent]) -> Option<Prediction> {
    let mut by_project: HashMap<i64, usize> = HashMap::new();
    let mut strongest = 0;
    for event in events {
        if canonical_app_name(&event.app_name) != canonical_app_name(&window.app_name) {
            continue;
        }
        let strength = if document_path(window.file_path.as_deref())
            .is_some_and(|path| document_path(event.file_path.as_deref()) == Some(path))
        {
            4
        } else if !window.window_title.trim().is_empty()
            && event.window_title.as_deref().is_some_and(|title| {
                title
                    .trim()
                    .eq_ignore_ascii_case(window.window_title.trim())
            })
        {
            3
        } else if window
            .url
            .as_deref()
            .and_then(rules::normalized_host)
            .is_some_and(|host| {
                event.domain.as_deref().and_then(rules::normalized_host) == Some(host)
            })
        {
            2
        } else {
            1
        };
        if strength > strongest {
            by_project.clear();
            strongest = strength;
        }
        if strength == strongest {
            *by_project.entry(event.project_id).or_default() += 1;
        }
    }
    let total: usize = by_project.values().sum();
    let (&project_id, &support) = by_project.iter().max_by_key(|(_, count)| **count)?;
    let confidence = support as f64 / total as f64;
    let (minimum_support, minimum_confidence) = if strongest == 1 { (3, 0.90) } else { (2, 0.60) };
    (support >= minimum_support && confidence >= minimum_confidence).then_some(Prediction {
        project_id,
        confidence,
    })
}

/// Preserve unknown application names; normalize known OS process/display aliases.
pub fn canonical_app_name(raw: &str) -> String {
    let trimmed = raw.trim();
    match trimmed.to_lowercase().trim_end_matches(".exe") {
        "chrome" | "google chrome" => "Google Chrome",
        "msedge" | "microsoft edge" => "Microsoft Edge",
        "code" | "visual studio code" => "Visual Studio Code",
        "brave" | "brave browser" => "Brave Browser",
        "firefox" => "Firefox",
        "safari" => "Safari",
        "duskry" => "Duskry",
        _ => return trimmed.to_lowercase(),
    }
    .to_lowercase()
}

pub fn display_app_name(raw: &str) -> String {
    match canonical_app_name(raw).as_str() {
        "google chrome" => "Google Chrome".into(),
        "microsoft edge" => "Microsoft Edge".into(),
        "visual studio code" => "Visual Studio Code".into(),
        "brave browser" => "Brave Browser".into(),
        "firefox" => "Firefox".into(),
        "safari" => "Safari".into(),
        "duskry" => "Duskry".into(),
        _ => raw.trim().to_string(),
    }
}

/// Remember the narrowest observed context. Never silently create an app-wide rule.
pub fn correction_pattern(window: &ActiveWindow) -> Option<String> {
    let (field, operator, value) = if let Some(path) = document_path(window.file_path.as_deref()) {
        ("path", "equals", path.to_string())
    } else if !window.window_title.trim().is_empty() {
        ("title", "equals", window.window_title.trim().to_string())
    } else {
        let host = window.url.as_deref().and_then(rules::normalized_host)?;
        ("url", "host_equals", host)
    };
    Some(
        serde_json::json!({"combinator":"and","conditions":[
            {"field":"app","operator":"equals","value":window.app_name},
            {"field":field,"operator":operator,"value":value}
        ]})
        .to_string(),
    )
}

fn document_path(value: Option<&str>) -> Option<&str> {
    value
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .filter(|path| {
            let lower = path.to_lowercase();
            !lower.starts_with("http://")
                && !lower.starts_with("https://")
                && ![".exe", ".dll", ".app"]
                    .iter()
                    .any(|suffix| lower.ends_with(suffix))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn window() -> ActiveWindow {
        ActiveWindow {
            app_name: "Code".into(),
            window_title: "Duskry".into(),
            url: None,
            file_path: None,
            timestamp: 1,
        }
    }
    fn event(project_id: i64, title: &str) -> db::LearningEvent {
        db::LearningEvent {
            project_id,
            app_name: "Visual Studio Code".into(),
            window_title: Some(title.into()),
            domain: None,
            file_path: None,
            started_at: 1,
        }
    }
    #[test]
    fn specific_evidence_beats_a_large_app_only_majority() {
        let mut events = vec![event(2, "Other"); 30];
        events.extend([event(1, "Duskry"), event(1, "Duskry")]);
        assert_eq!(predict(&window(), &events).unwrap().project_id, 1);
    }
    #[test]
    fn conflicting_or_insufficient_evidence_stays_unknown() {
        assert!(predict(&window(), &[event(1, "Duskry")]).is_none());
        assert!(predict(&window(), &[event(1, "Duskry"), event(2, "Duskry")]).is_none());
    }
    #[test]
    fn corrections_require_observed_context() {
        let mut w = window();
        let pattern = correction_pattern(&w).unwrap();
        assert!(pattern.contains("title"));
        w.window_title.clear();
        assert!(correction_pattern(&w).is_none());
        w.file_path = Some(r"C:\Program Files\Editor\editor.exe".into());
        assert!(correction_pattern(&w).is_none());
    }
    #[test]
    fn known_process_aliases_match_without_renaming_unknown_apps() {
        assert_eq!(
            canonical_app_name(" chrome.exe "),
            canonical_app_name("Google Chrome")
        );
        assert_eq!(display_app_name("Acme Editor Beta"), "Acme Editor Beta");
    }
}
