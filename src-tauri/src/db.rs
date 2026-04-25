use dirs::data_dir;
use once_cell::sync::Lazy;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

static DB: Lazy<Mutex<Connection>> = Lazy::new(|| {
    let path = get_db_path();
    let conn = Connection::open(&path).expect("Failed to open database");
    init_schema(&conn).expect("Failed to init schema");
    Mutex::new(conn)
});

fn get_db_path() -> PathBuf {
    let mut path = data_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("duskry");
    std::fs::create_dir_all(&path).ok();
    path.push("duskry.db");
    path
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
            priority   INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS assignments (
            activity_id INTEGER PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
            project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
            source      TEXT DEFAULT 'rule'
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
        INSERT OR IGNORE INTO settings VALUES ('auto_rule_suggestions_enabled', 'true');
        INSERT OR IGNORE INTO settings VALUES ('auto_create_suggested_rules_enabled', 'false');
    "#,
    )?;
    ensure_column(
        conn,
        "rule_learning_signals",
        "last_prompted_count",
        "ALTER TABLE rule_learning_signals ADD COLUMN last_prompted_count INTEGER NOT NULL DEFAULT 0",
    )?;
    Ok(())
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RuleSuggestion {
    pub project_id: i64,
    pub project_name: String,
    pub project_color: String,
    pub field: String,
    pub operator: String,
    pub value: String,
    pub count: i64,
    pub label: String,
}

pub fn save_activity_start(app_name: &str, window_title: &str, started_at: i64) -> Result<i64> {
    let conn = DB.lock().expect("db lock");
    conn.execute(
        "INSERT INTO activities (app_name, window_title, started_at) VALUES (?1, ?2, ?3)",
        params![app_name, window_title, started_at],
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
               ass.project_id, ass.source
        FROM activities a
        LEFT JOIN assignments ass ON ass.activity_id = a.id
        WHERE a.started_at >= ?1 AND a.started_at <= ?2
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
        })
    })?;
    rows.collect()
}

pub fn assign_activity(activity_id: i64, project_id: i64, source: &str) -> Result<()> {
    let conn = DB.lock().expect("db lock");
    conn.execute(
        "INSERT OR REPLACE INTO assignments (activity_id, project_id, source) VALUES (?1, ?2, ?3)",
        params![activity_id, project_id, source],
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
               ass.project_id, ass.source
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
            })
        },
    )
}

pub fn record_assignment_learning(activity: &Activity, project_id: i64) -> Result<()> {
    let conn = DB.lock().expect("db lock");
    let now = chrono::Utc::now().timestamp();
    if let Some(activity_id) = activity.id {
        conn.execute(
            r#"
            INSERT OR REPLACE INTO rule_learning_events
                (activity_id, project_id, app_name, window_title, domain, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
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
                activity
                    .domain
                    .as_deref()
                    .map(str::trim)
                    .filter(|v| !v.is_empty()),
                now,
            ],
        )?;
    }

    let mut candidates = vec![("app", "equals", activity.app_name.trim())];
    if let Some(domain) = activity
        .domain
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        candidates.push(("url", "contains", domain));
    }

    for (field, operator, value) in candidates {
        if value.is_empty() {
            continue;
        }
        conn.execute(
            r#"
            INSERT INTO rule_learning_signals
                (project_id, field, operator, value, count, dismissed, created, updated_at)
            VALUES (?1, ?2, ?3, ?4, 1, 0, 0, ?5)
            ON CONFLICT(project_id, field, operator, value) DO UPDATE SET
                count = count + 1,
                updated_at = excluded.updated_at
        "#,
            params![project_id, field, operator, value, now],
        )?;
    }
    Ok(())
}

pub fn get_rule_suggestion_for_activity(
    activity_id: i64,
    threshold: i64,
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

    let mut candidates = build_rich_rule_candidates(&conn, &activity, project_id, threshold)?;
    if let Some(domain) = activity
        .domain
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        candidates.push((
            "url".to_string(),
            "contains".to_string(),
            domain.to_string(),
            format!("domain contains \"{}\"", domain),
        ));
    }
    candidates.push((
        "app".to_string(),
        "equals".to_string(),
        activity.app_name.trim().to_string(),
        format!("app equals \"{}\"", activity.app_name.trim()),
    ));

    for (field, operator, value, label) in candidates {
        let count = signal_count(&conn, project_id, &field, &operator, &value)?;
        if suggestion_is_too_broad(&field, count) {
            continue;
        }
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
                params![project_id, field, operator, value, threshold],
                |_| Ok(()),
            )
            .is_ok();

        if can_prompt {
            mark_rule_suggestion_prompted_conn(
                &conn, project_id, &field, &operator, &value, count,
            )?;
            return Ok(Some(RuleSuggestion {
                project_id,
                project_name: project.0,
                project_color: project.1,
                field,
                operator,
                value,
                count,
                label,
            }));
        }
    }

    Ok(None)
}

fn suggestion_is_too_broad(field: &str, count: i64) -> bool {
    field == "app" && count < 6
}

fn build_rich_rule_candidates(
    conn: &Connection,
    activity: &Activity,
    project_id: i64,
    threshold: i64,
) -> Result<Vec<(String, String, String, String)>> {
    let app_name = activity.app_name.trim();
    if app_name.is_empty() {
        return Ok(Vec::new());
    }

    let mut candidates = Vec::new();
    let mut stmt = conn.prepare(
        r#"
        SELECT domain, COUNT(*) AS c
        FROM rule_learning_events
        WHERE project_id = ?1
          AND app_name = ?2
          AND domain IS NOT NULL
          AND length(trim(domain)) > 0
        GROUP BY domain
        ORDER BY c DESC, max(updated_at) DESC
        LIMIT 4
    "#,
    )?;
    let rows = stmt.query_map(params![project_id, app_name], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    let domains = rows.collect::<Result<Vec<_>>>()?;
    let domain_total: i64 = domains.iter().map(|(_, count)| *count).sum();
    if domain_total >= threshold && !domains.is_empty() {
        let domain_nodes: Vec<serde_json::Value> = domains
            .iter()
            .map(|(domain, _)| {
                serde_json::json!({
                    "field": "url",
                    "operator": "contains",
                    "value": domain,
                    "negated": false
                })
            })
            .collect();
        let value = serde_json::json!({
            "combinator": "and",
            "conditions": [
                {
                    "field": "app",
                    "operator": "equals",
                    "value": app_name,
                    "negated": false
                },
                {
                    "combinator": "or",
                    "conditions": domain_nodes
                }
            ]
        })
        .to_string();
        upsert_learning_signal_count(
            conn,
            project_id,
            "compound",
            "matches",
            &value,
            domain_total,
        )?;
        let joined = domains
            .iter()
            .map(|(domain, _)| format!("domain contains \"{}\"", domain))
            .collect::<Vec<_>>()
            .join(" OR ");
        candidates.push((
            "compound".to_string(),
            "matches".to_string(),
            value,
            format!("app equals \"{}\" AND ({})", app_name, joined),
        ));
    }

    Ok(candidates)
}

fn signal_count(
    conn: &Connection,
    project_id: i64,
    field: &str,
    operator: &str,
    value: &str,
) -> Result<i64> {
    conn.query_row(
        "SELECT count FROM rule_learning_signals WHERE project_id = ?1 AND field = ?2 AND operator = ?3 AND value = ?4",
        params![project_id, field, operator, value],
        |row| row.get(0),
    )
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
    count: i64,
) -> Result<()> {
    conn.execute(
        "UPDATE rule_learning_signals SET last_prompted_count = ?5 WHERE project_id = ?1 AND field = ?2 AND operator = ?3 AND value = ?4",
        params![project_id, field, operator, value, count],
    )?;
    Ok(())
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
    let mut stmt = conn.prepare(
        "SELECT id, project_id, field, operator, value, priority FROM rules ORDER BY priority DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Rule {
            id: row.get(0)?,
            project_id: row.get(1)?,
            field: row.get(2)?,
            operator: row.get(3)?,
            value: row.get(4)?,
            priority: row.get(5)?,
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
    let conn = DB.lock().expect("db lock");
    conn.execute(
        "INSERT INTO rules (project_id, field, operator, value, priority) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![project_id, field, operator, value, priority],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_rules_for_project(project_id: i64) -> Result<Vec<Rule>> {
    let conn = DB.lock().expect("db lock");
    let mut stmt = conn.prepare(
        "SELECT id, project_id, field, operator, value, priority FROM rules WHERE project_id = ?1 ORDER BY priority DESC, id ASC"
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok(Rule {
            id: row.get(0)?,
            project_id: row.get(1)?,
            field: row.get(2)?,
            operator: row.get(3)?,
            value: row.get(4)?,
            priority: row.get(5)?,
        })
    })?;
    rows.collect()
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
