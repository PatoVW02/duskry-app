use crate::tracker::ActiveWindow;
use crate::db::Rule;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct CompoundRule {
    combinator: String,
    conditions: Vec<RuleNode>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RuleNode {
    Group(CompoundRule),
    Condition(RuleCondition),
}

#[derive(Debug, Deserialize)]
struct RuleCondition {
    field: String,
    operator: String,
    value: String,
    #[serde(default)]
    negated: bool,
}

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
        .filter(|r| ((r.field == "app" || r.field == "url") || compound_uses_only_app_url(r)) && rule_matches(r, window))
        .collect();
    matching.sort_by(|a, b| b.priority.cmp(&a.priority));
    matching.first().map(|r| r.project_id)
}

fn rule_matches(rule: &Rule, window: &ActiveWindow) -> bool {
    if rule.field == "compound" {
        return compound_rule_matches(rule, window);
    }
    condition_matches(&rule.field, &rule.operator, &rule.value, false, window)
}

fn condition_matches(field: &str, operator: &str, value: &str, negated: bool, window: &ActiveWindow) -> bool {
    let haystack = match field {
        "app"   => window.app_name.to_lowercase(),
        "title" => window.window_title.to_lowercase(),
        "path"  => window.window_title.to_lowercase(), // best effort
        "url"   => window.url.as_deref().unwrap_or("").to_lowercase(),
        _       => return false,
    };
    let needle = value.to_lowercase();
    let matched = match operator {
        "contains"    => haystack.contains(&needle),
        "equals"      => haystack == needle,
        "starts_with" => haystack.starts_with(&needle),
        "ends_with"   => haystack.ends_with(&needle),
        _              => false,
    };
    if negated { !matched } else { matched }
}

fn compound_rule_matches(rule: &Rule, window: &ActiveWindow) -> bool {
    let Ok(compound) = serde_json::from_str::<CompoundRule>(&rule.value) else {
        return false;
    };
    group_matches(&compound, window)
}

fn group_matches(group: &CompoundRule, window: &ActiveWindow) -> bool {
    if group.conditions.is_empty() {
        return false;
    }
    let is_any = group.combinator == "or";
    if is_any {
        group.conditions.iter().any(|node| node_matches(node, window))
    } else {
        group.conditions.iter().all(|node| node_matches(node, window))
    }
}

fn node_matches(node: &RuleNode, window: &ActiveWindow) -> bool {
    match node {
        RuleNode::Group(group) => group_matches(group, window),
        RuleNode::Condition(condition) => {
            condition_matches(&condition.field, &condition.operator, &condition.value, condition.negated, window)
        }
    }
}

fn compound_uses_only_app_url(rule: &Rule) -> bool {
    if rule.field != "compound" {
        return false;
    }
    serde_json::from_str::<CompoundRule>(&rule.value)
        .map(|compound| {
            !compound.conditions.is_empty()
                && compound.conditions.iter().all(node_uses_only_app_url)
        })
        .unwrap_or(false)
}

fn node_uses_only_app_url(node: &RuleNode) -> bool {
    match node {
        RuleNode::Group(group) => {
            !group.conditions.is_empty() && group.conditions.iter().all(node_uses_only_app_url)
        }
        RuleNode::Condition(condition) => condition.field == "app" || condition.field == "url",
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
