use crate::tracker::ActiveWindow;
use crate::db::Rule;

pub fn apply_rules(window: &ActiveWindow, rules: &[Rule]) -> Option<i64> {
    let mut matching: Vec<&Rule> = rules.iter()
        .filter(|r| rule_matches(r, window))
        .collect();
    matching.sort_by(|a, b| b.priority.cmp(&a.priority));
    matching.first().map(|r| r.project_id)
}

/// Evaluate only app-name and URL rules. Used for the focus-project override check.
pub fn apply_app_url_rules(window: &ActiveWindow, rules: &[Rule]) -> Option<i64> {
    let mut matching: Vec<&Rule> = rules.iter()
        .filter(|r| (r.field == "app" || r.field == "url") && rule_matches(r, window))
        .collect();
    matching.sort_by(|a, b| b.priority.cmp(&a.priority));
    matching.first().map(|r| r.project_id)
}

fn rule_matches(rule: &Rule, window: &ActiveWindow) -> bool {
    let haystack = match rule.field.as_str() {
        "app"   => window.app_name.to_lowercase(),
        "title" => window.window_title.to_lowercase(),
        "path"  => window.window_title.to_lowercase(), // best effort
        "url"   => window.url.as_deref().unwrap_or("").to_lowercase(),
        _       => return false,
    };
    let needle = rule.value.to_lowercase();
    match rule.operator.as_str() {
        "contains"    => haystack.contains(&needle),
        "equals"      => haystack == needle,
        "starts_with" => haystack.starts_with(&needle),
        "ends_with"   => haystack.ends_with(&needle),
        _ => false,
    }
}

/// Public wrapper used for retroactive rule application.
pub fn rule_matches_one(rule: &Rule, window: &ActiveWindow) -> bool {
    rule_matches(rule, window)
}

pub fn auto_rules_for_project(project_name: &str) -> Vec<(String, String, String)> {
    let lower = project_name.to_lowercase();
    vec![
        ("app".to_string(), "contains".to_string(), lower.clone()),
        ("title".to_string(), "contains".to_string(), lower),
    ]
}
