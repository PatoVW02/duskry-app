use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use once_cell::sync::Lazy;
use dirs::data_dir;
use std::path::PathBuf;

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
    conn.execute_batch(r#"
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
    "#)?;
    Ok(())
}

pub fn get_setting(key: &str) -> Option<String> {
    let conn = DB.lock().ok()?;
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    ).ok()
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
    let duration = conn.query_row(
        "SELECT started_at FROM activities WHERE id = ?1",
        params![id],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(ended_at);
    conn.execute(
        "UPDATE activities SET ended_at = ?1, duration_s = ?2 WHERE id = ?3",
        params![ended_at, ended_at - duration, id],
    )?;
    Ok(())
}

pub fn get_today_activities() -> Result<Vec<Activity>> {
    let conn = DB.lock().expect("db lock");
    let today_start = {
        use chrono::{Local, Timelike};
        let now = Local::now();
        let midnight = now.with_hour(0).unwrap().with_minute(0).unwrap().with_second(0).unwrap();
        midnight.timestamp()
    };
    get_activities_in_range_conn(&conn, today_start, i64::MAX)
}

pub fn get_activities_in_range(from_ts: i64, to_ts: i64) -> Result<Vec<Activity>> {
    let conn = DB.lock().expect("db lock");
    get_activities_in_range_conn(&conn, from_ts, to_ts)
}

fn get_activities_in_range_conn(conn: &Connection, from_ts: i64, to_ts: i64) -> Result<Vec<Activity>> {
    let mut stmt = conn.prepare(r#"
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
    "#)?;
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

pub fn get_all_projects() -> Result<Vec<Project>> {
    let conn = DB.lock().expect("db lock");
    let mut stmt = conn.prepare(
        "SELECT id, name, color, icon, created_at FROM projects ORDER BY name"
    )?;
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

pub fn create_project(name: &str, color: &str) -> Result<i64> {
    let conn = DB.lock().expect("db lock");
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO projects (name, color, created_at) VALUES (?1, ?2, ?3)",
        params![name, color, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_all_rules() -> Result<Vec<Rule>> {
    let conn = DB.lock().expect("db lock");
    let mut stmt = conn.prepare(
        "SELECT id, project_id, field, operator, value, priority FROM rules ORDER BY priority DESC"
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

pub fn create_rule(project_id: i64, field: &str, operator: &str, value: &str, priority: i32) -> Result<i64> {
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
    let mut stmt = conn.prepare(r#"
        SELECT a.id, a.app_name, a.window_title, a.file_path, a.domain,
               a.started_at, a.ended_at, a.duration_s
        FROM activities a
        LEFT JOIN assignments ass ON ass.activity_id = a.id
        WHERE a.started_at >= ?1 AND a.started_at <= ?2
          AND ass.activity_id IS NULL
    "#)?;
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
        let midnight = now.with_hour(0).unwrap().with_minute(0).unwrap().with_second(0).unwrap();
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
