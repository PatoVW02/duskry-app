use crate::db::Rule;
use crate::tracker::ActiveWindow;
use chrono::{Local, TimeZone, Timelike};
use serde::Deserialize;
use std::cmp::Ordering;
use std::collections::HashSet;
use url::Url;

const MAX_RULE_VALUE_LEN: usize = 4_096;
const MAX_COMPOUND_DEPTH: usize = 4;
const MAX_COMPOUND_NODES: usize = 24;

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

#[derive(Debug, Clone, PartialEq)]
pub struct RuleMatch {
    pub rule_id: Option<i64>,
    pub project_id: i64,
    pub source: String,
    pub confidence: Option<f64>,
}

pub fn apply_rules(window: &ActiveWindow, rules: &[Rule]) -> Option<RuleMatch> {
    best_match(
        window,
        rules
            .iter()
            .filter(|rule| rule.enabled && rule_matches(rule, window)),
    )
}

/// Evaluate only app-name and URL rules. Used for the focus-project override check.
pub fn apply_app_url_rules(window: &ActiveWindow, rules: &[Rule]) -> Option<RuleMatch> {
    best_match(
        window,
        rules.iter().filter(|rule| {
            rule.enabled
                && ((rule.field == "app" || rule.field == "url")
                    || compound_uses_only_app_url(rule))
                && rule_matches(rule, window)
        }),
    )
}

fn best_match<'a>(
    window: &ActiveWindow,
    rules: impl Iterator<Item = &'a Rule>,
) -> Option<RuleMatch> {
    let mut matching: Vec<&Rule> = rules.collect();
    matching.sort_by(|left, right| compare_rule_rank(right, left, window));

    let winner = *matching.first()?;
    // Equally strong rules for different projects are ambiguous. Leaving the
    // activity unassigned is safer than silently picking whichever SQLite returned.
    if matching.iter().skip(1).any(|candidate| {
        winner.project_id != candidate.project_id && same_effective_rank(winner, candidate, window)
    }) {
        return None;
    }

    Some(RuleMatch {
        rule_id: winner.id,
        project_id: winner.project_id,
        source: winner.source.clone(),
        confidence: winner.confidence,
    })
}

fn compare_rule_rank(left: &Rule, right: &Rule, window: &ActiveWindow) -> Ordering {
    left.priority
        .cmp(&right.priority)
        .then_with(|| source_rank(&left.source).cmp(&source_rank(&right.source)))
        .then_with(|| rule_specificity(left, window).cmp(&rule_specificity(right, window)))
        .then_with(|| {
            left.confidence
                .unwrap_or(1.0)
                .partial_cmp(&right.confidence.unwrap_or(1.0))
                .unwrap_or(Ordering::Equal)
        })
        // Older explicit rules win the final deterministic tie-break.
        .then_with(|| {
            right
                .id
                .unwrap_or(i64::MAX)
                .cmp(&left.id.unwrap_or(i64::MAX))
        })
}

fn same_effective_rank(left: &Rule, right: &Rule, window: &ActiveWindow) -> bool {
    left.priority == right.priority
        && source_rank(&left.source) == source_rank(&right.source)
        && rule_specificity(left, window) == rule_specificity(right, window)
        && (left.confidence.unwrap_or(1.0) - right.confidence.unwrap_or(1.0)).abs() < 0.000_1
}

fn source_rank(source: &str) -> i32 {
    match source {
        "manual" => 3,
        "learned" => 2,
        _ => 1,
    }
}

fn rule_specificity(rule: &Rule, window: &ActiveWindow) -> i32 {
    if rule.field == "compound" {
        return serde_json::from_str::<CompoundRule>(&rule.value)
            .ok()
            .and_then(|compound| group_match_specificity(&compound, window))
            .unwrap_or(0);
    }
    condition_specificity(&rule.field, &rule.operator)
}

fn group_match_specificity(group: &CompoundRule, window: &ActiveWindow) -> Option<i32> {
    if group.conditions.is_empty() {
        return None;
    }

    let mut seen = HashSet::new();
    let mut matched_scores = Vec::new();
    for node in &group.conditions {
        let fingerprint = node_fingerprint(node);
        let score = node_match_specificity(node, window);
        if group.combinator == "and" && score.is_none() {
            return None;
        }
        if seen.insert(fingerprint) {
            if let Some(score) = score {
                matched_scores.push(score);
            }
        }
    }

    match group.combinator.as_str() {
        "and" => Some(matched_scores.into_iter().sum()),
        "or" => matched_scores.into_iter().max(),
        _ => None,
    }
}

fn node_match_specificity(node: &RuleNode, window: &ActiveWindow) -> Option<i32> {
    match node {
        RuleNode::Group(group) => group_match_specificity(group, window),
        RuleNode::Condition(condition) => condition_matches(
            &condition.field,
            &condition.operator,
            &condition.value,
            condition.negated,
            window,
        )
        .then(|| condition_specificity(&condition.field, &condition.operator)),
    }
}

fn node_fingerprint(node: &RuleNode) -> String {
    match node {
        RuleNode::Condition(condition) => format!(
            "condition:{}:{}:{}:{}",
            condition.field.trim().to_lowercase(),
            condition.operator.trim().to_lowercase(),
            condition.value.trim().to_lowercase(),
            condition.negated
        ),
        RuleNode::Group(group) => {
            let mut children: Vec<String> = group.conditions.iter().map(node_fingerprint).collect();
            children.sort();
            children.dedup();
            format!("group:{}:[{}]", group.combinator, children.join("|"))
        }
    }
}

fn condition_specificity(field: &str, operator: &str) -> i32 {
    let field_weight = match field {
        "url" | "path" => 3,
        "title" => 2,
        "app" | "hour" => 1,
        _ => 0,
    };
    let operator_weight = match operator {
        "equals" | "host_equals" => 4,
        "starts_with" | "ends_with" | "between_minutes" => 3,
        "contains" => 2,
        _ => 0,
    };
    field_weight + operator_weight
}

fn rule_matches(rule: &Rule, window: &ActiveWindow) -> bool {
    if rule.field == "compound" {
        return compound_rule_matches(rule, window);
    }
    condition_matches(&rule.field, &rule.operator, &rule.value, false, window)
}

fn condition_matches(
    field: &str,
    operator: &str,
    value: &str,
    negated: bool,
    window: &ActiveWindow,
) -> bool {
    if value.trim().is_empty() {
        return false;
    }
    if field == "hour" {
        return match_hour_condition(operator, value, negated, window);
    }

    if field == "url" {
        if !matches!(operator, "host_equals" | "contains") {
            return false;
        }
        let matched = normalized_host(window.url.as_deref().unwrap_or(""))
            .zip(normalized_rule_host(value))
            .map(|(actual, expected)| match operator {
                "host_equals" => actual == expected || actual.ends_with(&format!(".{expected}")),
                "contains" => actual.contains(&expected),
                _ => unreachable!("URL operator checked above"),
            })
            .unwrap_or(false);
        return if negated { !matched } else { matched };
    }

    let haystack = match field {
        "app" => window.app_name.to_lowercase(),
        "title" => window.window_title.to_lowercase(),
        "path" => window.file_path.as_deref().unwrap_or("").to_lowercase(),
        _ => return false,
    };
    let needle = value.to_lowercase();
    let matched = match operator {
        "contains" => haystack.contains(&needle),
        "equals" => haystack == needle,
        "starts_with" => haystack.starts_with(&needle),
        "ends_with" => haystack.ends_with(&needle),
        _ => return false,
    };
    if negated {
        !matched
    } else {
        matched
    }
}

fn match_hour_condition(operator: &str, value: &str, negated: bool, window: &ActiveWindow) -> bool {
    if !valid_hour_condition_value(operator, value) {
        return false;
    }
    let Some(local_time) = Local.timestamp_opt(window.timestamp, 0).single() else {
        return false;
    };
    let current_minutes = i64::from(local_time.hour()) * 60 + i64::from(local_time.minute());
    let matched = match operator {
        "equals" => value
            .parse::<i64>()
            .map(|hour| (0..=23).contains(&hour) && current_minutes / 60 == hour)
            .unwrap_or(false),
        "between_minutes" => {
            let Some((start, end)) = value.split_once('-') else {
                return false;
            };
            let Ok(start) = start.parse::<i64>() else {
                return false;
            };
            let Ok(end) = end.parse::<i64>() else {
                return false;
            };
            (0..=1_439).contains(&start)
                && (0..=1_439).contains(&end)
                && current_minutes >= start
                && current_minutes <= end
        }
        _ => return false,
    };
    if negated {
        !matched
    } else {
        matched
    }
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
    if group.combinator == "or" {
        group
            .conditions
            .iter()
            .any(|node| node_matches(node, window))
    } else if group.combinator == "and" {
        group
            .conditions
            .iter()
            .all(|node| node_matches(node, window))
    } else {
        false
    }
}

fn node_matches(node: &RuleNode, window: &ActiveWindow) -> bool {
    match node {
        RuleNode::Group(group) => group_matches(group, window),
        RuleNode::Condition(condition) => condition_matches(
            &condition.field,
            &condition.operator,
            &condition.value,
            condition.negated,
            window,
        ),
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

/// Public wrapper used for retroactive rule application and learning analysis.
pub fn rule_matches_one(rule: &Rule, window: &ActiveWindow) -> bool {
    rule.enabled && rule_matches(rule, window)
}

pub fn normalized_host(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let parsed = match Url::parse(trimmed) {
        Ok(parsed) if matches!(parsed.scheme(), "http" | "https") => parsed,
        Ok(_) => return None,
        Err(_) => Url::parse(&format!("https://{trimmed}")).ok()?,
    };
    let host = parsed.host_str()?.trim_end_matches('.').to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    (!host.is_empty()).then_some(host)
}

/// Normalize a user-provided hostname without accepting URL paths, queries,
/// fragments, credentials, ports, or whitespace. Rule values are persisted and
/// displayed in the UI, so accepting a full URL here could leak private data.
pub fn normalized_rule_host(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches('.');
    if trimmed.is_empty()
        || trimmed.chars().any(char::is_whitespace)
        || trimmed
            .chars()
            .any(|character| matches!(character, '/' | '\\' | '?' | '#' | '@' | ':'))
    {
        return None;
    }
    normalized_host(trimmed)
}

pub fn validate_rule(field: &str, operator: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err("Rule value cannot be empty.".to_string());
    }
    if value.len() > MAX_RULE_VALUE_LEN {
        return Err("Rule value is too long.".to_string());
    }
    if field == "compound" {
        if operator != "matches" {
            return Err("Compound rules must use the matches operator.".to_string());
        }
        let compound: CompoundRule =
            serde_json::from_str(value).map_err(|_| "Invalid compound rule.".to_string())?;
        let mut node_count = 0;
        return validate_group(&compound, 1, &mut node_count);
    }
    validate_condition(field, operator, value)
}

fn validate_group(
    group: &CompoundRule,
    depth: usize,
    node_count: &mut usize,
) -> Result<(), String> {
    if depth > MAX_COMPOUND_DEPTH {
        return Err("Rule groups can be nested at most 4 levels.".to_string());
    }
    if group.combinator != "and" && group.combinator != "or" {
        return Err("Rule groups must use all or any conditions.".to_string());
    }
    if group.conditions.is_empty() {
        return Err("Rule groups cannot be empty.".to_string());
    }
    for node in &group.conditions {
        *node_count += 1;
        if *node_count > MAX_COMPOUND_NODES {
            return Err("A rule can contain at most 24 conditions.".to_string());
        }
        match node {
            RuleNode::Group(group) => validate_group(group, depth + 1, node_count)?,
            RuleNode::Condition(condition) => {
                validate_condition(&condition.field, &condition.operator, &condition.value)?
            }
        }
    }
    Ok(())
}

fn validate_condition(field: &str, operator: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err("Rule conditions cannot be empty.".to_string());
    }
    let valid = match field {
        "app" | "title" | "path" => {
            matches!(
                operator,
                "contains" | "equals" | "starts_with" | "ends_with"
            )
        }
        "url" => matches!(operator, "contains" | "host_equals"),
        "hour" => matches!(operator, "equals" | "between_minutes"),
        _ => false,
    };
    if !valid {
        return Err(format!("Unsupported rule condition: {field} {operator}."));
    }
    if field == "hour" && !valid_hour_condition_value(operator, value) {
        return Err("Hour rules require a valid hour or minute range.".to_string());
    }
    if field == "url" && normalized_rule_host(value).is_none() {
        return Err("Website rules require a hostname without a path or query.".to_string());
    }
    Ok(())
}

fn valid_hour_condition_value(operator: &str, value: &str) -> bool {
    match operator {
        "equals" => value
            .parse::<i64>()
            .map(|hour| (0..=23).contains(&hour))
            .unwrap_or(false),
        "between_minutes" => value
            .split_once('-')
            .and_then(|(start, end)| Some((start.parse::<i64>().ok()?, end.parse::<i64>().ok()?)))
            .map(|(start, end)| {
                (0..=1_439).contains(&start) && (0..=1_439).contains(&end) && start <= end
            })
            .unwrap_or(false),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window() -> ActiveWindow {
        ActiveWindow {
            app_name: "Visual Studio Code".to_string(),
            window_title: "rules.rs — Duskry".to_string(),
            url: Some("https://docs.github.com/actions?token=private".to_string()),
            file_path: Some("/Users/test/Duskry/src-tauri/src/rules.rs".to_string()),
            timestamp: chrono::Utc::now().timestamp(),
        }
    }

    fn rule(field: &str, operator: &str, value: &str) -> Rule {
        Rule {
            id: Some(1),
            project_id: 7,
            field: field.to_string(),
            operator: operator.to_string(),
            value: value.to_string(),
            priority: 0,
            source: "manual".to_string(),
            enabled: true,
            confidence: None,
            support_count: 0,
            created_at: None,
        }
    }

    #[test]
    fn path_rules_use_the_document_path() {
        assert!(rule_matches_one(
            &rule("path", "contains", "src-tauri/src"),
            &window()
        ));
        assert!(!rule_matches_one(
            &rule("path", "contains", "rules.rs — Duskry"),
            &window()
        ));
    }

    #[test]
    fn hostname_matching_respects_domain_boundaries() {
        assert!(rule_matches_one(
            &rule("url", "host_equals", "github.com"),
            &window()
        ));
        let mut malicious = window();
        malicious.url = Some("https://github.com.evil.test".to_string());
        assert!(!rule_matches_one(
            &rule("url", "host_equals", "github.com"),
            &malicious
        ));
    }

    #[test]
    fn internal_and_non_web_schemes_are_not_website_hosts() {
        assert_eq!(
            normalized_host("https://docs.github.com/private"),
            Some("docs.github.com".to_string())
        );
        assert_eq!(
            normalized_host("docs.github.com"),
            Some("docs.github.com".to_string())
        );
        assert_eq!(normalized_host("chrome://settings"), None);
        assert_eq!(normalized_host("about:blank"), None);
        assert_eq!(normalized_host("file:///Users/test/private.txt"), None);
    }

    #[test]
    fn url_contains_only_checks_the_normalized_hostname() {
        assert!(rule_matches_one(
            &rule("url", "contains", "github"),
            &window()
        ));
        assert!(!rule_matches_one(
            &rule("url", "contains", "actions"),
            &window()
        ));
        assert!(!rule_matches_one(
            &rule("url", "contains", "token=private"),
            &window()
        ));
    }

    #[test]
    fn url_rules_reject_paths_queries_and_legacy_operators() {
        assert!(validate_rule("url", "host_equals", "docs.github.com").is_ok());
        assert!(validate_rule("url", "contains", "github").is_ok());
        assert!(validate_rule("url", "host_equals", "https://github.com/private").is_err());
        assert!(validate_rule("url", "contains", "github.com?token=private").is_err());
        assert!(validate_rule("url", "equals", "github.com").is_err());
    }

    #[test]
    fn invalid_negated_operator_never_becomes_a_match() {
        let value = serde_json::json!({
            "combinator": "and",
            "conditions": [{
                "field": "app",
                "operator": "unknown",
                "value": "Safari",
                "negated": true
            }]
        })
        .to_string();
        assert!(!rule_matches_one(
            &rule("compound", "matches", &value),
            &window()
        ));
        assert!(validate_rule("compound", "matches", &value).is_err());
    }

    #[test]
    fn unsupported_negated_url_and_hour_operators_never_match() {
        let url_value = serde_json::json!({
            "combinator": "and",
            "conditions": [{
                "field": "url",
                "operator": "equals",
                "value": "github.com",
                "negated": true
            }]
        })
        .to_string();
        assert!(!rule_matches_one(
            &rule("compound", "matches", &url_value),
            &window()
        ));

        let hour_value = serde_json::json!({
            "combinator": "and",
            "conditions": [{
                "field": "hour",
                "operator": "contains",
                "value": "12",
                "negated": true
            }]
        })
        .to_string();
        assert!(!rule_matches_one(
            &rule("compound", "matches", &hour_value),
            &window()
        ));
    }

    #[test]
    fn invalid_hour_values_are_rejected_and_never_inverted_by_negation() {
        assert!(validate_rule("hour", "equals", "23").is_ok());
        assert!(validate_rule("hour", "between_minutes", "0-1439").is_ok());
        assert!(validate_rule("hour", "equals", "24").is_err());
        assert!(validate_rule("hour", "equals", "-1").is_err());
        assert!(validate_rule("hour", "between_minutes", "0-1440").is_err());
        assert!(validate_rule("hour", "between_minutes", "600-500").is_err());

        for (operator, value) in [("equals", "99"), ("between_minutes", "600-500")] {
            let compound = serde_json::json!({
                "combinator": "and",
                "conditions": [{
                    "field": "hour",
                    "operator": operator,
                    "value": value,
                    "negated": true
                }]
            })
            .to_string();
            assert!(!rule_matches_one(
                &rule("compound", "matches", &compound),
                &window()
            ));
        }
    }

    #[test]
    fn equal_conflicting_rules_are_left_unassigned() {
        let mut first = rule("app", "equals", "Visual Studio Code");
        let mut second = first.clone();
        first.id = Some(1);
        second.id = Some(2);
        second.project_id = 9;
        assert!(apply_rules(&window(), &[first, second]).is_none());
    }

    #[test]
    fn conflict_is_detected_even_after_two_rules_for_the_same_project() {
        let first = rule("app", "equals", "Visual Studio Code");
        let mut duplicate = first.clone();
        duplicate.id = Some(2);
        let mut conflicting = first.clone();
        conflicting.id = Some(3);
        conflicting.project_id = 9;
        assert!(apply_rules(&window(), &[first, duplicate, conflicting]).is_none());
    }

    #[test]
    fn explicit_rule_wins_over_an_equally_specific_learned_rule() {
        let manual = rule("app", "equals", "Visual Studio Code");
        let mut learned = manual.clone();
        learned.id = Some(2);
        learned.project_id = 9;
        learned.source = "learned".to_string();
        learned.confidence = Some(0.99);
        assert_eq!(
            apply_rules(&window(), &[learned, manual])
                .unwrap()
                .project_id,
            7
        );
    }

    #[test]
    fn explicit_rule_wins_over_a_more_specific_learned_rule() {
        let manual = rule("app", "contains", "Visual Studio");
        let mut learned = rule(
            "compound",
            "matches",
            &serde_json::json!({
                "combinator": "and",
                "conditions": [
                    { "field": "app", "operator": "equals", "value": "Visual Studio Code" },
                    { "field": "path", "operator": "contains", "value": "Duskry" }
                ]
            })
            .to_string(),
        );
        learned.id = Some(2);
        learned.project_id = 9;
        learned.source = "learned".to_string();
        learned.confidence = Some(0.99);
        assert_eq!(
            apply_rules(&window(), &[learned, manual])
                .unwrap()
                .project_id,
            7
        );
    }

    #[test]
    fn only_the_matching_or_branch_contributes_specificity() {
        let direct = rule("app", "equals", "Visual Studio Code");
        let mut alternatives = rule(
            "compound",
            "matches",
            &serde_json::json!({
                "combinator": "or",
                "conditions": [
                    { "field": "path", "operator": "equals", "value": "/not/the/current/path" },
                    { "field": "app", "operator": "contains", "value": "Visual Studio" }
                ]
            })
            .to_string(),
        );
        alternatives.id = Some(2);
        alternatives.project_id = 9;

        assert_eq!(
            apply_rules(&window(), &[alternatives, direct])
                .unwrap()
                .project_id,
            7
        );
    }

    #[test]
    fn duplicate_and_conditions_do_not_inflate_specificity() {
        let direct = rule("app", "equals", "Visual Studio Code");
        let mut duplicated = rule(
            "compound",
            "matches",
            &serde_json::json!({
                "combinator": "and",
                "conditions": [
                    { "field": "app", "operator": "contains", "value": "Visual Studio" },
                    { "field": "app", "operator": "contains", "value": "Visual Studio" }
                ]
            })
            .to_string(),
        );
        duplicated.id = Some(2);
        duplicated.project_id = 9;

        assert_eq!(
            apply_rules(&window(), &[duplicated, direct])
                .unwrap()
                .project_id,
            7
        );
    }
}
