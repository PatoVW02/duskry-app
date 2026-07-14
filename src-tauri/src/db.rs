use chrono::TimeZone;
use once_cell::sync::Lazy;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

static DB: Lazy<Mutex<Connection>> = Lazy::new(|| {
    let path = get_db_path();
    let conn = Connection::open(&path).expect("Failed to open database");
    conn.pragma_update(None, "foreign_keys", "ON")
        .expect("Failed to enable foreign keys");
    init_schema(&conn).expect("Failed to init schema");
    Mutex::new(conn)
});

fn get_db_path() -> PathBuf {
    crate::paths::app_data_file("duskry.db")
}

fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS activities (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            app_name     TEXT NOT NULL,
            window_title TEXT,
            file_path    TEXT,
            domain       TEXT,
            started_at   INTEGER NOT NULL,
            ended_at     INTEGER,
            duration_s   INTEGER
        );

        CREATE TABLE IF NOT EXISTS projects (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            color      TEXT DEFAULT '#86EFAC',
            icon       TEXT,
            created_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS rules (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
            field      TEXT NOT NULL,
            operator   TEXT NOT NULL,
            value      TEXT NOT NULL,
            priority   INTEGER DEFAULT 0,
            source     TEXT NOT NULL DEFAULT 'manual',
            enabled    INTEGER NOT NULL DEFAULT 1,
            confidence REAL,
            support_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS assignments (
            activity_id INTEGER PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
            project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
            source      TEXT DEFAULT 'rule',
            rule_id     INTEGER REFERENCES rules(id) ON DELETE SET NULL,
            confidence  REAL,
            reason      TEXT
        );

        CREATE TABLE IF NOT EXISTS rule_learning_signals (
            project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            field       TEXT NOT NULL,
            operator    TEXT NOT NULL,
            value       TEXT NOT NULL,
            count       INTEGER NOT NULL DEFAULT 0,
            dismissed   INTEGER NOT NULL DEFAULT 0,
            created     INTEGER NOT NULL DEFAULT 0,
            last_prompted_count INTEGER NOT NULL DEFAULT 0,
            updated_at  INTEGER NOT NULL,
            PRIMARY KEY (project_id, field, operator, value)
        );

        CREATE TABLE IF NOT EXISTS rule_learning_events (
            activity_id  INTEGER PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
            project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            app_name     TEXT NOT NULL,
            window_title TEXT,
            domain       TEXT,
            file_path    TEXT,
            started_at   INTEGER,
            updated_at   INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS license (
            id              INTEGER PRIMARY KEY DEFAULT 1,
            key_hash        TEXT,
            tier            TEXT DEFAULT 'free',
            status          TEXT DEFAULT 'inactive',
            last_validated  INTEGER,
            CHECK (id = 1)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        INSERT OR IGNORE INTO license (id) VALUES (1);
        INSERT OR IGNORE INTO settings VALUES ('onboarding_complete',  'false');
        INSERT OR IGNORE INTO settings VALUES ('trial_email',          '');
        INSERT OR IGNORE INTO settings VALUES ('trial_started_at',     '0');
        INSERT OR IGNORE INTO settings VALUES ('trial_expires_at',     '0');
        INSERT OR IGNORE INTO settings VALUES ('trial_status',         'none');
        INSERT OR IGNORE INTO settings VALUES ('scene',                'night-mountains');
        INSERT OR IGNORE INTO settings VALUES ('scene_auto',           'true');
        INSERT OR IGNORE INTO settings VALUES ('scene_auto_schedule',  '[{"startMinutes":0,"scene":"arctic-night"},{"startMinutes":300,"scene":"golden-meadow"},{"startMinutes":480,"scene":"alpine-day"},{"startMinutes":720,"scene":"coastal-breeze"},{"startMinutes":1020,"scene":"ocean-sunset"},{"startMinutes":1200,"scene":"night-mountains"}]');
        INSERT OR IGNORE INTO settings VALUES ('auto_rule_suggestions_enabled', 'true');
        INSERT OR IGNORE INTO settings VALUES ('auto_create_suggested_rules_enabled', 'false');

        CREATE INDEX IF NOT EXISTS idx_activities_started_at ON activities(started_at);
        CREATE INDEX IF NOT EXISTS idx_activities_ended_at ON activities(ended_at);
        CREATE INDEX IF NOT EXISTS idx_assignments_project_id ON assignments(project_id);
        CREATE INDEX IF NOT EXISTS idx_rules_project_priority ON rules(project_id, priority);
        CREATE INDEX IF NOT EXISTS idx_learning_signals_updated ON rule_learning_signals(updated_at);
    "#,
    )?;
    ensure_column(
        conn,
        "rule_learning_signals",
        "last_prompted_count",
        "ALTER TABLE rule_learning_signals ADD COLUMN last_prompted_count INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "rule_learning_events",
        "file_path",
        "ALTER TABLE rule_learning_events ADD COLUMN file_path TEXT",
    )?;
    ensure_column(
        conn,
        "rule_learning_events",
        "started_at",
        "ALTER TABLE rule_learning_events ADD COLUMN started_at INTEGER",
    )?;
    ensure_column(
        conn,
        "rules",
        "source",
        "ALTER TABLE rules ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'",
    )?;
    ensure_column(
        conn,
        "rules",
        "enabled",
        "ALTER TABLE rules ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1",
    )?;
    ensure_column(
        conn,
        "rules",
        "confidence",
        "ALTER TABLE rules ADD COLUMN confidence REAL",
    )?;
    ensure_column(
        conn,
        "rules",
        "support_count",
        "ALTER TABLE rules ADD COLUMN support_count INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "rules",
        "created_at",
        "ALTER TABLE rules ADD COLUMN created_at INTEGER",
    )?;
    ensure_column(
        conn,
        "assignments",
        "rule_id",
        "ALTER TABLE assignments ADD COLUMN rule_id INTEGER REFERENCES rules(id) ON DELETE SET NULL",
    )?;
    ensure_column(
        conn,
        "assignments",
        "confidence",
        "ALTER TABLE assignments ADD COLUMN confidence REAL",
    )?;
    ensure_column(
        conn,
        "assignments",
        "reason",
        "ALTER TABLE assignments ADD COLUMN reason TEXT",
    )?;
    sanitize_legacy_url_data(conn)?;
    Ok(())
}

/// Older builds could persist an AXDocument HTTP URL as a file path and could
/// store full URL rule values. Scrub those once so paths, queries, fragments,
/// and credentials are not exposed by activity/rule APIs after upgrading.
fn sanitize_legacy_url_data(conn: &Connection) -> Result<()> {
    let already_sanitized = conn
        .query_row(
            "SELECT 1 FROM settings WHERE key = 'url_privacy_migration_v1'",
            [],
            |_| Ok(()),
        )
        .is_ok();
    if already_sanitized {
        return Ok(());
    }
    let transaction = conn.unchecked_transaction()?;

    for table in ["activities", "rule_learning_events"] {
        let mut stmt = transaction.prepare(&format!(
            "SELECT rowid, domain FROM {table} WHERE domain IS NOT NULL"
        ))?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        let domains = rows.collect::<Result<Vec<_>>>()?;
        drop(stmt);
        for (row_id, domain) in domains {
            let hostname = crate::rules::normalized_host(&domain);
            transaction.execute(
                &format!("UPDATE {table} SET domain = ?1 WHERE rowid = ?2"),
                params![hostname, row_id],
            )?;
        }
        transaction.execute(
            &format!("UPDATE {table} SET file_path = NULL WHERE file_path LIKE '%://%'"),
            [],
        )?;
    }

    let mut stmt = transaction.prepare("SELECT id, field, operator, value, enabled FROM rules")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
        ))
    })?;
    let stored_rules = rows.collect::<Result<Vec<_>>>()?;
    drop(stmt);
    for (id, field, operator, value, enabled) in stored_rules {
        if let Some((safe_operator, safe_value, url_conditions_valid)) =
            sanitize_stored_rule(&field, &operator, &value)
        {
            transaction.execute(
                "UPDATE rules SET operator = ?2, value = ?3, enabled = ?4 WHERE id = ?1",
                params![
                    id,
                    safe_operator,
                    safe_value,
                    i64::from(enabled != 0 && url_conditions_valid)
                ],
            )?;
        }
    }

    // Website suggestions are derived and can be rebuilt. Preserve unrelated
    // app/title/path compound dismissals while dropping only compounds that
    // actually contain a serialized URL condition.
    transaction.execute("DELETE FROM rule_learning_signals WHERE field = 'url'", [])?;
    let mut stmt = transaction.prepare(
        "SELECT project_id, field, operator, value FROM rule_learning_signals WHERE field = 'compound'",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    let compound_signals = rows.collect::<Result<Vec<_>>>()?;
    drop(stmt);
    for (project_id, field, operator, value) in compound_signals {
        if compound_contains_url_condition(&value) {
            transaction.execute(
                "DELETE FROM rule_learning_signals WHERE project_id = ?1 AND field = ?2 AND operator = ?3 AND value = ?4",
                params![project_id, field, operator, value],
            )?;
        }
    }
    transaction.execute(
        "INSERT INTO settings (key, value) VALUES ('url_privacy_migration_v1', 'true')",
        [],
    )?;
    transaction.commit()
}

fn sanitize_stored_rule(
    field: &str,
    operator: &str,
    value: &str,
) -> Option<(String, String, bool)> {
    if field == "url" {
        let hostname = crate::rules::normalized_host(value).unwrap_or_default();
        let original_value_was_hostname = crate::rules::normalized_rule_host(value).is_some();
        let (operator, valid_operator) = match operator {
            "host_equals" => ("host_equals", true),
            "contains" => ("contains", true),
            _ => ("host_equals", false),
        };
        return Some((
            operator.to_string(),
            hostname.clone(),
            valid_operator && original_value_was_hostname && !hostname.is_empty(),
        ));
    }
    if field != "compound" {
        return None;
    }

    let Ok(mut compound) = serde_json::from_str::<serde_json::Value>(value) else {
        return None;
    };
    let mut found_url = false;
    let mut valid = true;
    sanitize_compound_url_conditions(&mut compound, &mut found_url, &mut valid);
    found_url.then(|| (operator.to_string(), compound.to_string(), valid))
}

fn compound_contains_url_condition(value: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(value)
        .map(|node| node_contains_url_condition(&node))
        .unwrap_or(false)
}

fn node_contains_url_condition(node: &serde_json::Value) -> bool {
    if node.get("field").and_then(serde_json::Value::as_str) == Some("url") {
        return true;
    }
    node.get("conditions")
        .and_then(serde_json::Value::as_array)
        .map(|conditions| conditions.iter().any(node_contains_url_condition))
        .unwrap_or(false)
}

fn sanitize_compound_url_conditions(
    node: &mut serde_json::Value,
    found_url: &mut bool,
    valid: &mut bool,
) {
    if let Some(conditions) = node
        .get_mut("conditions")
        .and_then(serde_json::Value::as_array_mut)
    {
        for condition in conditions {
            sanitize_compound_url_conditions(condition, found_url, valid);
        }
        return;
    }

    let is_url = node.get("field").and_then(serde_json::Value::as_str) == Some("url");
    if !is_url {
        return;
    }
    *found_url = true;
    let current_operator = node
        .get("operator")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let (safe_operator, valid_operator) = match current_operator {
        "host_equals" => ("host_equals", true),
        "contains" => ("contains", true),
        _ => ("host_equals", false),
    };
    let current_value = node
        .get("value")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let original_value_was_hostname = crate::rules::normalized_rule_host(current_value).is_some();
    let hostname = crate::rules::normalized_host(current_value).unwrap_or_default();
    if let Some(object) = node.as_object_mut() {
        object.insert(
            "operator".to_string(),
            serde_json::Value::String(safe_operator.to_string()),
        );
        object.insert(
            "value".to_string(),
            serde_json::Value::String(hostname.clone()),
        );
    }
    *valid &= valid_operator && original_value_was_hostname && !hostname.is_empty();
}

fn ensure_column(conn: &Connection, table: &str, column: &str, alter_sql: &str) -> Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for name in rows {
        if name? == column {
            return Ok(());
        }
    }
    conn.execute(alter_sql, [])?;
    Ok(())
}

pub fn get_setting(key: &str) -> Option<String> {
    let conn = DB.lock().ok()?;
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .ok()
}

pub fn set_setting(key: &str, value: &str) -> Result<()> {
    let conn = DB.lock().expect("db lock");
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}

pub fn set_rule_automation_mode(mode: &str) -> Result<()> {
    let (suggestions, automatic) = match mode {
        "off" => ("false", "false"),
        "suggest" => ("true", "false"),
        "automatic" => ("true", "true"),
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    let mut conn = DB.lock().expect("db lock");
    let transaction = conn.transaction()?;
    transaction.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_rule_suggestions_enabled', ?1)",
        params![suggestions],
    )?;
    transaction.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_create_suggested_rules_enabled', ?1)",
        params![automatic],
    )?;
    transaction.commit()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Activity {
    pub id: Option<i64>,
    pub app_name: String,
    pub window_title: Option<String>,
    pub file_path: Option<String>,
    pub domain: Option<String>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub duration_s: Option<i64>,
    pub project_id: Option<i64>,
    pub source: Option<String>,
    pub rule_id: Option<i64>,
    pub assignment_confidence: Option<f64>,
    pub assignment_reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: Option<i64>,
    pub name: String,
    pub color: String,
    pub icon: Option<String>,
    pub created_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Rule {
    pub id: Option<i64>,
    pub project_id: i64,
    pub field: String,
    pub operator: String,
    pub value: String,
    pub priority: i32,
    pub source: String,
    pub enabled: bool,
    pub confidence: Option<f64>,
    pub support_count: i64,
    pub created_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RuleSuggestion {
    pub rule_id: Option<i64>,
    pub project_id: i64,
    pub project_name: String,
    pub project_color: String,
    pub field: String,
    pub operator: String,
    pub value: String,
    pub count: i64,
    pub total_count: i64,
    pub day_count: i64,
    pub confidence: f64,
    pub auto_created: bool,
    pub label: String,
}

#[derive(Debug, Clone)]
pub struct LearningEvent {
    pub project_id: i64,
    pub app_name: String,
    pub window_title: Option<String>,
    pub domain: Option<String>,
    pub file_path: Option<String>,
    pub started_at: i64,
}

pub struct RuleMetadata<'a> {
    pub priority: i32,
    pub source: &'a str,
    pub enabled: bool,
    pub confidence: Option<f64>,
    pub support_count: i64,
}

pub fn save_activity_start(
    app_name: &str,
    window_title: &str,
    file_path: Option<&str>,
    domain: Option<&str>,
    started_at: i64,
) -> Result<i64> {
    let conn = DB.lock().expect("db lock");
    conn.execute(
        "INSERT INTO activities (app_name, window_title, file_path, domain, started_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![app_name, window_title, file_path, domain, started_at],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn finish_activity(id: i64, ended_at: i64) -> Result<()> {
    let conn = DB.lock().expect("db lock");
    let started_at = conn
        .query_row(
            "SELECT started_at FROM activities WHERE id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(ended_at);
    let ended_at = ended_at.max(started_at);
    conn.execute(
        "UPDATE activities SET ended_at = ?1, duration_s = ?2 WHERE id = ?3",
        params![ended_at, ended_at - started_at, id],
    )?;
    Ok(())
}

pub fn close_open_activities(default_end_at: i64) -> Result<usize> {
    let conn = DB.lock().expect("db lock");
    let mut stmt = conn.prepare(
        r#"
        SELECT id, started_at,
               (SELECT MIN(next.started_at)
                FROM activities next
                WHERE next.started_at > current.started_at) AS next_started_at
        FROM activities current
        WHERE ended_at IS NULL
        ORDER BY started_at ASC
    "#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, Option<i64>>(2)?,
        ))
    })?;

    let open_activities: Result<Vec<_>> = rows.collect();
    let open_activities = open_activities?;
    drop(stmt);

    for (id, started_at, next_started_at) in &open_activities {
        let ended_at = next_started_at.unwrap_or(default_end_at).max(*started_at);
        conn.execute(
            "UPDATE activities SET ended_at = ?1, duration_s = ?2 WHERE id = ?3",
            params![ended_at, ended_at - started_at, id],
        )?;
    }

    Ok(open_activities.len())
}

pub fn get_today_activities() -> Result<Vec<Activity>> {
    let conn = DB.lock().expect("db lock");
    let today_start = {
        use chrono::{Local, Timelike};
        let now = Local::now();
        let midnight = now
            .with_hour(0)
            .unwrap()
            .with_minute(0)
            .unwrap()
            .with_second(0)
            .unwrap();
        midnight.timestamp()
    };
    get_activities_in_range_conn(&conn, today_start, i64::MAX)
}

pub fn get_activities_in_range(from_ts: i64, to_ts: i64) -> Result<Vec<Activity>> {
    let conn = DB.lock().expect("db lock");
    get_activities_in_range_conn(&conn, from_ts, to_ts)
}

fn get_activities_in_range_conn(
    conn: &Connection,
    from_ts: i64,
    to_ts: i64,
) -> Result<Vec<Activity>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT a.id, a.app_name, a.window_title, a.file_path, a.domain,
               a.started_at, a.ended_at,
               COALESCE(a.duration_s,
                   CASE WHEN a.ended_at IS NULL
                        THEN (unixepoch() - a.started_at)
                        ELSE NULL END) AS duration_s,
               ass.project_id, ass.source, ass.rule_id, ass.confidence, ass.reason
        FROM activities a
        LEFT JOIN assignments ass ON ass.activity_id = a.id
        WHERE a.started_at <= ?2
          AND COALESCE(a.ended_at, unixepoch()) >= ?1
        ORDER BY a.started_at DESC
    "#,
    )?;
    let rows = stmt.query_map(params![from_ts, to_ts], |row| {
        Ok(Activity {
            id: row.get(0)?,
            app_name: row.get(1)?,
            window_title: row.get(2)?,
            file_path: row.get(3)?,
            domain: row.get(4)?,
            started_at: row.get(5)?,
            ended_at: row.get(6)?,
            duration_s: row.get(7)?,
            project_id: row.get(8)?,
            source: row.get(9)?,
            rule_id: row.get(10)?,
            assignment_confidence: row.get(11)?,
            assignment_reason: row.get(12)?,
        })
    })?;
    rows.collect()
}

/// Assign a collection of activities atomically. If any activity or project is
/// invalid, the whole batch is rolled back so a drag/drop cannot leave a
/// partially-assigned selection.
pub fn assign_activities(activity_ids: &[i64], project_id: i64, source: &str) -> Result<()> {
    let mut conn = DB.lock().expect("db lock");
    let transaction = conn.transaction()?;
    for activity_id in activity_ids {
        transaction.execute(
            "INSERT OR REPLACE INTO assignments (activity_id, project_id, source, rule_id, confidence, reason) VALUES (?1, ?2, ?3, NULL, NULL, NULL)",
            params![activity_id, project_id, source],
        )?;
    }
    transaction.commit()
}

pub fn assign_activity_with_decision(
    activity_id: i64,
    project_id: i64,
    source: &str,
    rule_id: Option<i64>,
    confidence: Option<f64>,
    reason: Option<&str>,
) -> Result<()> {
    let conn = DB.lock().expect("db lock");
    conn.execute(
        "INSERT OR REPLACE INTO assignments (activity_id, project_id, source, rule_id, confidence, reason) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![activity_id, project_id, source, rule_id, confidence, reason],
    )?;
    Ok(())
}

pub fn unassign_activity(activity_id: i64) -> Result<()> {
    let conn = DB.lock().expect("db lock");
    conn.execute(
        "DELETE FROM assignments WHERE activity_id = ?1",
        params![activity_id],
    )?;
    Ok(())
}

pub fn remove_assignment_learning(activity_id: i64) -> Result<()> {
    let conn = DB.lock().expect("db lock");
    conn.execute(
        "DELETE FROM rule_learning_events WHERE activity_id = ?1",
        params![activity_id],
    )?;
    Ok(())
}

pub fn get_activity(activity_id: i64) -> Result<Activity> {
    let conn = DB.lock().expect("db lock");
    conn.query_row(
        r#"
        SELECT a.id, a.app_name, a.window_title, a.file_path, a.domain,
               a.started_at, a.ended_at,
               COALESCE(a.duration_s,
                   CASE WHEN a.ended_at IS NULL
                        THEN (unixepoch() - a.started_at)
                        ELSE NULL END) AS duration_s,
               ass.project_id, ass.source, ass.rule_id, ass.confidence, ass.reason
        FROM activities a
        LEFT JOIN assignments ass ON ass.activity_id = a.id
        WHERE a.id = ?1
    "#,
        params![activity_id],
        |row| {
            Ok(Activity {
                id: row.get(0)?,
                app_name: row.get(1)?,
                window_title: row.get(2)?,
                file_path: row.get(3)?,
                domain: row.get(4)?,
                started_at: row.get(5)?,
                ended_at: row.get(6)?,
                duration_s: row.get(7)?,
                project_id: row.get(8)?,
                source: row.get(9)?,
                rule_id: row.get(10)?,
                assignment_confidence: row.get(11)?,
                assignment_reason: row.get(12)?,
            })
        },
    )
}

/// Replace the learning evidence for a set of manually assigned activities in
/// one transaction. URL-shaped AXDocument values are never copied into the
/// file-path evidence column.
pub fn record_assignment_learning_batch(activities: &[Activity], project_id: i64) -> Result<()> {
    let mut conn = DB.lock().expect("db lock");
    let transaction = conn.transaction()?;
    let now = chrono::Utc::now().timestamp();
    for activity in activities {
        let Some(activity_id) = activity.id else {
            continue;
        };
        let hostname = activity
            .domain
            .as_deref()
            .and_then(crate::rules::normalized_host);
        let file_path = activity
            .file_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .filter(|value| !is_http_url(value));
        transaction.execute(
            r#"
            INSERT OR REPLACE INTO rule_learning_events
                (activity_id, project_id, app_name, window_title, domain, file_path, started_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
            params![
                activity_id,
                project_id,
                activity.app_name.trim(),
                activity
                    .window_title
                    .as_deref()
                    .map(str::trim)
                    .filter(|v| !v.is_empty()),
                hostname,
                file_path,
                activity.started_at,
                now,
            ],
        )?;
    }
    transaction.commit()
}

fn is_http_url(value: &str) -> bool {
    let lower = value.trim_start().to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://")
}

pub fn get_rule_suggestion_for_activity(
    activity_id: i64,
    automatic: bool,
) -> Result<Option<RuleSuggestion>> {
    let activity = get_activity(activity_id)?;
    let Some(project_id) = activity.project_id else {
        return Ok(None);
    };

    let conn = DB.lock().expect("db lock");
    let project = conn.query_row(
        "SELECT name, color FROM projects WHERE id = ?1",
        params![project_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )?;

    let candidates = build_confident_candidates(&conn, &activity, project_id, automatic)?;

    for candidate in candidates {
        upsert_learning_signal_count(
            &conn,
            project_id,
            &candidate.field,
            &candidate.operator,
            &candidate.value,
            candidate.support,
        )?;
        let can_prompt = conn
            .query_row(
                r#"
            SELECT 1
            FROM rule_learning_signals l
            WHERE l.project_id = ?1
              AND l.field = ?2
              AND l.operator = ?3
              AND l.value = ?4
              AND l.count >= ?5
              AND l.count >= l.last_prompted_count + ?5
              AND l.dismissed = 0
              AND l.created = 0
              AND NOT EXISTS (
                  SELECT 1 FROM rules r
                  WHERE r.project_id = l.project_id
                    AND r.field = l.field
                    AND r.operator = l.operator
                    AND lower(r.value) = lower(l.value)
              )
        "#,
                params![
                    project_id,
                    candidate.field,
                    candidate.operator,
                    candidate.value,
                    candidate.minimum_support
                ],
                |_| Ok(()),
            )
            .is_ok();

        if can_prompt {
            return Ok(Some(RuleSuggestion {
                rule_id: None,
                project_id,
                project_name: project.0,
                project_color: project.1,
                field: candidate.field,
                operator: candidate.operator,
                value: candidate.value,
                count: candidate.support,
                total_count: candidate.total,
                day_count: candidate.day_count,
                confidence: candidate.confidence,
                auto_created: false,
                label: candidate.label,
            }));
        }
    }

    Ok(None)
}

struct ConfidentCandidate {
    field: String,
    operator: String,
    value: String,
    label: String,
    support: i64,
    total: i64,
    day_count: i64,
    confidence: f64,
    specificity: i32,
    minimum_support: i64,
}

fn build_confident_candidates(
    conn: &Connection,
    activity: &Activity,
    project_id: i64,
    automatic: bool,
) -> Result<Vec<ConfidentCandidate>> {
    let app_name = activity.app_name.trim();
    if app_name.is_empty() {
        return Ok(Vec::new());
    }

    let mut raw_candidates = Vec::new();
    let hostname = activity
        .domain
        .as_deref()
        .and_then(crate::rules::normalized_host);
    if let Some(host) = hostname.as_deref() {
        raw_candidates.push((
            "compound".to_string(),
            "matches".to_string(),
            compound_rule_json(vec![
                rule_condition("app", "equals", app_name),
                rule_condition("url", "host_equals", host),
            ]),
            format!("{} is open on {}", app_name, host),
            8,
        ));
        raw_candidates.push((
            "url".to_string(),
            "host_equals".to_string(),
            host.to_string(),
            format!("the website is {}", host),
            7,
        ));
    }

    if let Some(path) = activity
        .file_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .filter(|path| !is_http_url(path))
        .filter(|path| {
            !matches!(
                std::path::Path::new(path)
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .map(str::to_lowercase)
                    .as_deref(),
                Some("exe" | "dll" | "app")
            )
        })
    {
        let file_label = std::path::Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("the same file");
        raw_candidates.push((
            "compound".to_string(),
            "matches".to_string(),
            compound_rule_json(vec![
                rule_condition("app", "equals", app_name),
                rule_condition("path", "equals", path),
            ]),
            format!("{} is working with {}", app_name, file_label),
            9,
        ));
    }

    if let Some(title) = activity
        .window_title
        .as_deref()
        .map(str::trim)
        .filter(|title| title.chars().count() >= 3)
    {
        raw_candidates.push((
            "compound".to_string(),
            "matches".to_string(),
            compound_rule_json(vec![
                rule_condition("app", "equals", app_name),
                rule_condition("title", "equals", title),
            ]),
            format!("{} has the window title \"{}\"", app_name, title),
            7,
        ));
    }

    raw_candidates.push((
        "app".to_string(),
        "equals".to_string(),
        app_name.to_string(),
        format!("the app is {}", app_name),
        5,
    ));

    let events = get_learning_events_conn(conn)?;
    let existing_rules = get_all_rules_conn(conn)?;
    let current_window = crate::tracker::ActiveWindow {
        app_name: activity.app_name.clone(),
        window_title: activity.window_title.clone().unwrap_or_default(),
        url: activity.domain.clone(),
        file_path: activity.file_path.clone(),
        timestamp: activity.started_at,
    };
    if existing_rules.iter().any(|rule| {
        let mut rule = rule.clone();
        rule.enabled = true;
        crate::rules::rule_matches_one(&rule, &current_window)
    }) {
        return Ok(Vec::new());
    }
    let mut candidates = Vec::new();

    for (field, operator, value, label, specificity) in raw_candidates {
        if existing_rules.iter().any(|rule| {
            rule.field == field
                && rule.operator == operator
                && rule.value.eq_ignore_ascii_case(&value)
        }) {
            continue;
        }

        let candidate_rule = Rule {
            id: None,
            project_id,
            field: field.clone(),
            operator: operator.clone(),
            value: value.clone(),
            priority: 0,
            source: "learned".to_string(),
            enabled: true,
            confidence: None,
            support_count: 0,
            created_at: None,
        };
        let mut support = 0_i64;
        let mut total = 0_i64;
        let mut days = std::collections::HashSet::new();
        for event in &events {
            let window = crate::tracker::ActiveWindow {
                app_name: event.app_name.clone(),
                window_title: event.window_title.clone().unwrap_or_default(),
                url: event.domain.clone(),
                file_path: event.file_path.clone(),
                timestamp: event.started_at,
            };
            if crate::rules::rule_matches_one(&candidate_rule, &window) {
                total += 1;
                if event.project_id == project_id {
                    support += 1;
                    if let Some(day) = chrono::Local
                        .timestamp_opt(event.started_at, 0)
                        .single()
                        .map(|date| date.date_naive())
                    {
                        days.insert(day);
                    }
                }
            }
        }
        if total == 0 {
            continue;
        }
        let confidence = support as f64 / total as f64;
        let (minimum_support, minimum_confidence, minimum_days) =
            automation_requirements(&field, automatic);
        if support < minimum_support
            || confidence + f64::EPSILON < minimum_confidence
            || days.len() < minimum_days
        {
            continue;
        }
        candidates.push(ConfidentCandidate {
            field,
            operator,
            value,
            label,
            support,
            total,
            day_count: days.len() as i64,
            confidence,
            specificity,
            minimum_support,
        });
    }

    candidates.sort_by(|left, right| {
        right
            .specificity
            .cmp(&left.specificity)
            .then_with(|| {
                right
                    .confidence
                    .partial_cmp(&left.confidence)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| right.support.cmp(&left.support))
    });
    Ok(candidates)
}

fn automation_requirements(field: &str, automatic: bool) -> (i64, f64, usize) {
    let is_app_only = field == "app";
    if automatic {
        if is_app_only {
            (8, 0.95, 2)
        } else {
            (5, 0.90, 2)
        }
    } else if is_app_only {
        (6, 0.90, 1)
    } else {
        (3, 0.75, 1)
    }
}

fn get_learning_events_conn(conn: &Connection) -> Result<Vec<LearningEvent>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT e.project_id, e.app_name, e.window_title, e.domain, e.file_path,
               COALESCE(e.started_at, a.started_at)
        FROM rule_learning_events e
        JOIN activities a ON a.id = e.activity_id
        WHERE COALESCE(a.duration_s, unixepoch() - a.started_at) >= 30
        "#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(LearningEvent {
            project_id: row.get(0)?,
            app_name: row.get(1)?,
            window_title: row.get(2)?,
            domain: row.get(3)?,
            file_path: row.get(4)?,
            started_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn get_learning_events() -> Result<Vec<LearningEvent>> {
    let conn = DB.lock().expect("db lock");
    get_learning_events_conn(&conn)
}

fn rule_condition(field: &str, operator: &str, value: &str) -> serde_json::Value {
    serde_json::json!({
        "field": field,
        "operator": operator,
        "value": value,
        "negated": false
    })
}

fn compound_rule_json(conditions: Vec<serde_json::Value>) -> String {
    serde_json::json!({
        "combinator": "and",
        "conditions": conditions,
    })
    .to_string()
}

fn upsert_learning_signal_count(
    conn: &Connection,
    project_id: i64,
    field: &str,
    operator: &str,
    value: &str,
    count: i64,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(r#"
        INSERT INTO rule_learning_signals
            (project_id, field, operator, value, count, dismissed, created, last_prompted_count, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, 0, ?6)
        ON CONFLICT(project_id, field, operator, value) DO UPDATE SET
            count = excluded.count,
            updated_at = excluded.updated_at
    "#, params![project_id, field, operator, value, count, now])?;
    Ok(())
}

fn mark_rule_suggestion_prompted_conn(
    conn: &Connection,
    project_id: i64,
    field: &str,
    operator: &str,
    value: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE rule_learning_signals SET last_prompted_count = count WHERE project_id = ?1 AND field = ?2 AND operator = ?3 AND value = ?4",
        params![project_id, field, operator, value],
    )?;
    Ok(())
}

pub fn mark_rule_suggestion_prompted(
    project_id: i64,
    field: &str,
    operator: &str,
    value: &str,
) -> Result<()> {
    let conn = DB.lock().expect("db lock");
    mark_rule_suggestion_prompted_conn(&conn, project_id, field, operator, value)
}

pub fn dismiss_rule_suggestion(
    project_id: i64,
    field: &str,
    operator: &str,
    value: &str,
) -> Result<()> {
    let conn = DB.lock().expect("db lock");
    conn.execute(
        "UPDATE rule_learning_signals SET dismissed = 1 WHERE project_id = ?1 AND field = ?2 AND operator = ?3 AND value = ?4",
        params![project_id, field, operator, value],
    )?;
    Ok(())
}

pub fn mark_rule_suggestion_created(
    project_id: i64,
    field: &str,
    operator: &str,
    value: &str,
) -> Result<()> {
    let conn = DB.lock().expect("db lock");
    conn.execute(
        "UPDATE rule_learning_signals SET created = 1 WHERE project_id = ?1 AND field = ?2 AND operator = ?3 AND value = ?4",
        params![project_id, field, operator, value],
    )?;
    Ok(())
}

pub fn get_all_projects() -> Result<Vec<Project>> {
    let conn = DB.lock().expect("db lock");
    let mut stmt =
        conn.prepare("SELECT id, name, color, icon, created_at FROM projects ORDER BY name")?;
    let rows = stmt.query_map([], |row| {
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            icon: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn count_projects() -> Result<i64> {
    let conn = DB.lock().expect("db lock");
    conn.query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
}

pub fn create_project(name: &str, color: &str) -> Result<i64> {
    let conn = DB.lock().expect("db lock");
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO projects (name, color, created_at) VALUES (?1, ?2, ?3)",
        params![name, color, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_project(project_id: i64) -> Result<()> {
    let conn = DB.lock().expect("db lock");
    conn.execute(
        "DELETE FROM assignments WHERE project_id = ?1",
        params![project_id],
    )?;
    conn.execute(
        "DELETE FROM rule_learning_events WHERE project_id = ?1",
        params![project_id],
    )?;
    conn.execute(
        "DELETE FROM rule_learning_signals WHERE project_id = ?1",
        params![project_id],
    )?;
    conn.execute(
        "DELETE FROM rules WHERE project_id = ?1",
        params![project_id],
    )?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![project_id])?;
    Ok(())
}

pub fn get_all_rules() -> Result<Vec<Rule>> {
    let conn = DB.lock().expect("db lock");
    get_all_rules_conn(&conn)
}

fn get_all_rules_conn(conn: &Connection) -> Result<Vec<Rule>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, field, operator, value, priority, source, enabled, confidence, support_count, created_at FROM rules ORDER BY priority DESC, id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Rule {
            id: row.get(0)?,
            project_id: row.get(1)?,
            field: row.get(2)?,
            operator: row.get(3)?,
            value: row.get(4)?,
            priority: row.get(5)?,
            source: row.get(6)?,
            enabled: row.get::<_, i64>(7)? != 0,
            confidence: row.get(8)?,
            support_count: row.get(9)?,
            created_at: row.get(10)?,
        })
    })?;
    rows.collect()
}

pub fn create_rule(
    project_id: i64,
    field: &str,
    operator: &str,
    value: &str,
    priority: i32,
) -> Result<i64> {
    create_rule_with_metadata(
        project_id,
        field,
        operator,
        value,
        RuleMetadata {
            priority,
            source: "manual",
            enabled: true,
            confidence: None,
            support_count: 0,
        },
    )
}

pub fn create_rule_with_metadata(
    project_id: i64,
    field: &str,
    operator: &str,
    value: &str,
    metadata: RuleMetadata<'_>,
) -> Result<i64> {
    let conn = DB.lock().expect("db lock");
    create_rule_with_metadata_conn(&conn, project_id, field, operator, value, metadata)
}

fn create_rule_with_metadata_conn(
    conn: &Connection,
    project_id: i64,
    field: &str,
    operator: &str,
    value: &str,
    metadata: RuleMetadata<'_>,
) -> Result<i64> {
    if let Ok(existing_id) = conn.query_row(
        "SELECT id FROM rules WHERE project_id = ?1 AND field = ?2 AND operator = ?3 AND lower(value) = lower(?4) LIMIT 1",
        params![project_id, field, operator, value],
        |row| row.get::<_, i64>(0),
    ) {
        // Explicit user intent takes ownership of an identical rule. This also
        // reactivates a safety-paused learned rule or a manually paused rule,
        // instead of returning an ID for a rule that still cannot run.
        if metadata.source == "manual" {
            conn.execute(
                "UPDATE rules SET value = ?2, priority = ?3, source = 'manual', enabled = 1, confidence = NULL, support_count = 0 WHERE id = ?1",
                params![existing_id, value, metadata.priority],
            )?;
        }
        return Ok(existing_id);
    }
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO rules (project_id, field, operator, value, priority, source, enabled, confidence, support_count, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![project_id, field, operator, value, metadata.priority, metadata.source, i64::from(metadata.enabled), metadata.confidence, metadata.support_count, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_rules_for_project(project_id: i64) -> Result<Vec<Rule>> {
    let conn = DB.lock().expect("db lock");
    let mut stmt = conn.prepare(
        "SELECT id, project_id, field, operator, value, priority, source, enabled, confidence, support_count, created_at FROM rules WHERE project_id = ?1 ORDER BY priority DESC, id ASC"
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok(Rule {
            id: row.get(0)?,
            project_id: row.get(1)?,
            field: row.get(2)?,
            operator: row.get(3)?,
            value: row.get(4)?,
            priority: row.get(5)?,
            source: row.get(6)?,
            enabled: row.get::<_, i64>(7)? != 0,
            confidence: row.get(8)?,
            support_count: row.get(9)?,
            created_at: row.get(10)?,
        })
    })?;
    rows.collect()
}

pub fn set_rule_enabled(id: i64, enabled: bool) -> Result<()> {
    let conn = DB.lock().expect("db lock");
    set_rule_enabled_conn(&conn, id, enabled)
}

fn set_rule_enabled_conn(conn: &Connection, id: i64, enabled: bool) -> Result<()> {
    if enabled {
        // Resuming a safety-paused learned rule is an explicit user override.
        // Convert it to a manual rule so a later evidence refresh does not
        // immediately undo the user's choice.
        conn.execute(
            "UPDATE rules SET enabled = 1, source = 'manual', confidence = NULL, support_count = 0 WHERE id = ?1 AND source = 'learned'",
            params![id],
        )?;
        conn.execute("UPDATE rules SET enabled = 1 WHERE id = ?1", params![id])?;
    } else {
        conn.execute("UPDATE rules SET enabled = 0 WHERE id = ?1", params![id])?;
    }
    Ok(())
}

pub fn update_learned_rule_stats(
    id: i64,
    confidence: f64,
    support_count: i64,
    keep_enabled: bool,
) -> Result<()> {
    let conn = DB.lock().expect("db lock");
    conn.execute(
        "UPDATE rules SET confidence = ?2, support_count = ?3, enabled = CASE WHEN enabled = 1 THEN ?4 ELSE 0 END WHERE id = ?1 AND source = 'learned'",
        params![id, confidence, support_count, i64::from(keep_enabled)],
    )?;
    Ok(())
}

pub fn delete_rule(id: i64) -> Result<()> {
    let conn = DB.lock().expect("db lock");
    conn.execute("DELETE FROM rules WHERE id = ?1", params![id])?;
    Ok(())
}

// ─── Activity mutations ────────────────────────────────────────────────────

pub fn delete_activity(id: i64) -> Result<()> {
    let conn = DB.lock().expect("db lock");
    conn.execute("DELETE FROM activities WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn update_activity(
    id: i64,
    app_name: &str,
    window_title: &str,
    started_at: i64,
    ended_at: i64,
) -> Result<()> {
    let duration = (ended_at - started_at).max(0);
    let conn = DB.lock().expect("db lock");
    conn.execute(
        "UPDATE activities SET app_name = ?1, window_title = ?2, started_at = ?3, ended_at = ?4, duration_s = ?5 WHERE id = ?6",
        params![app_name, window_title, started_at, ended_at, duration, id],
    )?;
    conn.execute(
        "UPDATE rule_learning_events SET app_name = ?1, window_title = ?2, started_at = ?3, updated_at = unixepoch() WHERE activity_id = ?4",
        params![app_name, window_title, started_at, id],
    )?;
    Ok(())
}

pub fn create_manual_activity(
    title: &str,
    note: &str,
    project_id: Option<i64>,
    started_at: i64,
    duration_s: i64,
) -> Result<()> {
    let ended_at = started_at + duration_s;
    let note_val: Option<&str> = if note.is_empty() { None } else { Some(note) };
    let conn = DB.lock().expect("db lock");
    conn.execute(
        "INSERT INTO activities (app_name, window_title, started_at, ended_at, duration_s) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![title, note_val, started_at, ended_at, duration_s],
    )?;
    let act_id = conn.last_insert_rowid();
    if let Some(pid) = project_id {
        conn.execute(
            "INSERT OR REPLACE INTO assignments (activity_id, project_id, source) VALUES (?1, ?2, 'manual')",
            params![act_id, pid],
        )?;
    }
    Ok(())
}

pub fn get_unassigned_activities_in_range(from_ts: i64, to_ts: i64) -> Result<Vec<Activity>> {
    let conn = DB.lock().expect("db lock");
    let mut stmt = conn.prepare(
        r#"
        SELECT a.id, a.app_name, a.window_title, a.file_path, a.domain,
               a.started_at, a.ended_at, a.duration_s
        FROM activities a
        LEFT JOIN assignments ass ON ass.activity_id = a.id
        WHERE a.started_at >= ?1 AND a.started_at <= ?2
          AND ass.activity_id IS NULL
    "#,
    )?;
    let rows = stmt.query_map(params![from_ts, to_ts], |row| {
        Ok(Activity {
            id: row.get(0)?,
            app_name: row.get(1)?,
            window_title: row.get(2)?,
            file_path: row.get(3)?,
            domain: row.get(4)?,
            started_at: row.get(5)?,
            ended_at: row.get(6)?,
            duration_s: row.get(7)?,
            project_id: None,
            source: None,
            rule_id: None,
            assignment_confidence: None,
            assignment_reason: None,
        })
    })?;
    rows.collect()
}

pub fn assign_all_unassigned_today(project_id: i64) -> Result<i32> {
    use chrono::{Local, Timelike};
    let today_start = {
        let now = Local::now();
        let midnight = now
            .with_hour(0)
            .unwrap()
            .with_minute(0)
            .unwrap()
            .with_second(0)
            .unwrap();
        midnight.timestamp()
    };
    let conn = DB.lock().expect("db lock");
    let count = conn.execute(
        r#"INSERT OR IGNORE INTO assignments (activity_id, project_id, source)
           SELECT a.id, ?1, 'bulk'
           FROM activities a
           LEFT JOIN assignments ass ON ass.activity_id = a.id
           WHERE a.started_at >= ?2 AND ass.activity_id IS NULL"#,
        params![project_id, today_start],
    )?;
    Ok(count as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_migration_adds_rule_provenance_and_assignment_explanations() {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.execute_batch(
            r#"
            CREATE TABLE activities (
                id INTEGER PRIMARY KEY,
                app_name TEXT NOT NULL,
                window_title TEXT,
                file_path TEXT,
                domain TEXT,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                duration_s INTEGER
            );
            CREATE TABLE projects (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT,
                icon TEXT,
                created_at INTEGER
            );
            CREATE TABLE rules (
                id INTEGER PRIMARY KEY,
                project_id INTEGER,
                field TEXT NOT NULL,
                operator TEXT NOT NULL,
                value TEXT NOT NULL,
                priority INTEGER DEFAULT 0
            );
            CREATE TABLE assignments (
                activity_id INTEGER PRIMARY KEY,
                project_id INTEGER,
                source TEXT DEFAULT 'rule'
            );
            "#,
        )
        .expect("legacy schema");
        init_schema(&conn).expect("schema initializes");
        init_schema(&conn).expect("schema migration is idempotent");

        let rule_columns = table_columns(&conn, "rules");
        for expected in [
            "source",
            "enabled",
            "confidence",
            "support_count",
            "created_at",
        ] {
            assert!(rule_columns.iter().any(|column| column == expected));
        }
        let assignment_columns = table_columns(&conn, "assignments");
        for expected in ["rule_id", "confidence", "reason"] {
            assert!(assignment_columns.iter().any(|column| column == expected));
        }
    }

    #[test]
    fn url_privacy_migration_scrubs_legacy_urls_and_disables_broadened_rules() {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.execute_batch(
            r#"
            CREATE TABLE activities (
                id INTEGER PRIMARY KEY,
                app_name TEXT NOT NULL,
                window_title TEXT,
                file_path TEXT,
                domain TEXT,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                duration_s INTEGER
            );
            CREATE TABLE projects (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT,
                icon TEXT,
                created_at INTEGER
            );
            CREATE TABLE rules (
                id INTEGER PRIMARY KEY,
                project_id INTEGER,
                field TEXT NOT NULL,
                operator TEXT NOT NULL,
                value TEXT NOT NULL,
                priority INTEGER DEFAULT 0
            );
            CREATE TABLE rule_learning_events (
                activity_id INTEGER PRIMARY KEY,
                project_id INTEGER NOT NULL,
                app_name TEXT NOT NULL,
                window_title TEXT,
                domain TEXT,
                file_path TEXT,
                started_at INTEGER,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE rule_learning_signals (
                project_id INTEGER NOT NULL,
                field TEXT NOT NULL,
                operator TEXT NOT NULL,
                value TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                dismissed INTEGER NOT NULL DEFAULT 0,
                created INTEGER NOT NULL DEFAULT 0,
                last_prompted_count INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (project_id, field, operator, value)
            );
            INSERT INTO projects (id, name, color) VALUES (1, 'Private', '#000');
            INSERT INTO activities
                (id, app_name, window_title, file_path, domain, started_at)
            VALUES
                (1, 'Safari', 'Private', 'vscode://private?token=secret',
                 'https://docs.example.com/private?token=secret', 1);
            INSERT INTO rule_learning_events
                (activity_id, project_id, app_name, domain, file_path, started_at, updated_at)
            VALUES
                (1, 1, 'Safari', 'https://docs.example.com/private?token=secret',
                 'custom://private?token=secret', 1, 1);
            INSERT INTO rules (id, project_id, field, operator, value, priority) VALUES
                (1, 1, 'url', 'contains', 'https://docs.example.com/private?token=secret', 0),
                (2, 1, 'url', 'contains', 'example', 0),
                (3, 1, 'url', 'equals', 'docs.example.com', 0);
            "#,
        )
        .expect("legacy rows");
        let compound = serde_json::json!({
            "combinator": "and",
            "conditions": [
                {"field": "app", "operator": "equals", "value": "Safari", "negated": false},
                {"field": "url", "operator": "equals", "value": "https://docs.example.com/private?token=secret", "negated": false}
            ]
        })
        .to_string();
        conn.execute(
            "INSERT INTO rules (id, project_id, field, operator, value, priority) VALUES (4, 1, 'compound', 'matches', ?1, 0)",
            params![&compound],
        )
        .expect("compound rule");
        let non_url_compound = serde_json::json!({
            "combinator": "and",
            "conditions": [
                {"field": "app", "operator": "equals", "value": "Safari", "negated": false},
                {"field": "title", "operator": "contains", "value": "Documentation", "negated": false}
            ]
        })
        .to_string();
        for value in [&compound, &non_url_compound] {
            conn.execute(
                "INSERT INTO rule_learning_signals (project_id, field, operator, value, count, dismissed, created, last_prompted_count, updated_at) VALUES (1, 'compound', 'matches', ?1, 4, 1, 0, 4, 1)",
                params![value],
            )
            .expect("learning signal");
        }

        init_schema(&conn).expect("privacy migration");

        let (domain, path): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT domain, file_path FROM activities WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("activity");
        assert_eq!(domain.as_deref(), Some("docs.example.com"));
        assert_eq!(path, None);
        let (event_domain, event_path): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT domain, file_path FROM rule_learning_events WHERE activity_id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("event");
        assert_eq!(event_domain.as_deref(), Some("docs.example.com"));
        assert_eq!(event_path, None);

        let unsafe_rule: (String, String, i64) = conn
            .query_row(
                "SELECT operator, value, enabled FROM rules WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("unsafe rule");
        assert_eq!(
            unsafe_rule,
            ("contains".to_string(), "docs.example.com".to_string(), 0)
        );
        let safe_rule: (String, i64) = conn
            .query_row("SELECT value, enabled FROM rules WHERE id = 2", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .expect("safe rule");
        assert_eq!(safe_rule, ("example".to_string(), 1));
        let legacy_equals: (String, i64) = conn
            .query_row(
                "SELECT operator, enabled FROM rules WHERE id = 3",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("legacy equals");
        assert_eq!(legacy_equals, ("host_equals".to_string(), 0));
        let (compound_value, compound_enabled): (String, i64) = conn
            .query_row("SELECT value, enabled FROM rules WHERE id = 4", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .expect("compound migrated");
        assert!(!compound_value.contains("private"));
        assert!(!compound_value.contains("secret"));
        assert!(compound_value.contains("docs.example.com"));
        assert_eq!(compound_enabled, 0);
        let url_signal_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM rule_learning_signals WHERE value = ?1",
                params![compound],
                |row| row.get(0),
            )
            .expect("URL signal count");
        assert_eq!(url_signal_count, 0);
        let non_url_signal_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM rule_learning_signals WHERE value = ?1 AND dismissed = 1",
                params![non_url_compound],
                |row| row.get(0),
            )
            .expect("non-URL signal count");
        assert_eq!(non_url_signal_count, 1);
    }

    #[test]
    fn autopilot_requires_stronger_and_multi_day_evidence() {
        assert_eq!(automation_requirements("compound", false), (3, 0.75, 1));
        assert_eq!(automation_requirements("compound", true), (5, 0.90, 2));
        assert_eq!(automation_requirements("app", false), (6, 0.90, 1));
        assert_eq!(automation_requirements("app", true), (8, 0.95, 2));
    }

    #[test]
    fn manual_creation_reactivates_an_identical_paused_learned_rule() {
        let conn = Connection::open_in_memory().expect("in-memory database");
        init_schema(&conn).expect("schema initializes");
        conn.execute(
            "INSERT INTO projects (id, name, color) VALUES (1, 'Duskry', '#000000')",
            [],
        )
        .expect("project");
        let learned_id = create_rule_with_metadata_conn(
            &conn,
            1,
            "app",
            "equals",
            "Safari",
            RuleMetadata {
                priority: 0,
                source: "learned",
                enabled: false,
                confidence: Some(0.72),
                support_count: 5,
            },
        )
        .expect("learned rule");

        let manual_id = create_rule_with_metadata_conn(
            &conn,
            1,
            "app",
            "equals",
            "Safari",
            RuleMetadata {
                priority: 10,
                source: "manual",
                enabled: true,
                confidence: None,
                support_count: 0,
            },
        )
        .expect("manual takeover");

        assert_eq!(manual_id, learned_id);
        let (source, enabled, priority, confidence, support): (
            String,
            i64,
            i32,
            Option<f64>,
            i64,
        ) = conn
            .query_row(
                "SELECT source, enabled, priority, confidence, support_count FROM rules WHERE id = ?1",
                params![manual_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("converted rule");
        assert_eq!(source, "manual");
        assert_eq!(enabled, 1);
        assert_eq!(priority, 10);
        assert_eq!(confidence, None);
        assert_eq!(support, 0);
    }

    #[test]
    fn explicitly_resuming_a_learned_rule_takes_manual_ownership() {
        let conn = Connection::open_in_memory().expect("in-memory database");
        init_schema(&conn).expect("schema initializes");
        conn.execute(
            "INSERT INTO projects (id, name, color) VALUES (1, 'Duskry', '#000000')",
            [],
        )
        .expect("project");
        let rule_id = create_rule_with_metadata_conn(
            &conn,
            1,
            "app",
            "equals",
            "Safari",
            RuleMetadata {
                priority: 0,
                source: "learned",
                enabled: false,
                confidence: Some(0.72),
                support_count: 5,
            },
        )
        .expect("learned rule");

        set_rule_enabled_conn(&conn, rule_id, true).expect("resume rule");

        let (source, enabled, confidence, support): (String, i64, Option<f64>, i64) = conn
            .query_row(
                "SELECT source, enabled, confidence, support_count FROM rules WHERE id = ?1",
                params![rule_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("resumed rule");
        assert_eq!(source, "manual");
        assert_eq!(enabled, 1);
        assert_eq!(confidence, None);
        assert_eq!(support, 0);
    }

    fn table_columns(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .expect("table info");
        stmt.query_map([], |row| row.get(1))
            .expect("column rows")
            .collect::<Result<Vec<_>>>()
            .expect("columns")
    }
}
