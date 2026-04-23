use tauri::{AppHandle, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, CheckMenuItem};
use tauri::tray::TrayIconBuilder;

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .menu_on_left_click(true)
        .tooltip("Duskry")
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id().as_ref());
        })
        .build(app)?;
    Ok(())
}

pub fn rebuild_tray(app: &AppHandle) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id("main") {
        let menu = build_menu(app)?;
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let projects   = crate::db::get_all_projects().unwrap_or_default();
    let active_id  = crate::db::get_setting("active_project_id")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    let paused = crate::tracker::TRACKING_PAUSED
        .load(std::sync::atomic::Ordering::SeqCst);

    // ── Focus label (non-clickable header) ───────────────────────
    let focus_label = if active_id > 0 {
        let name = projects.iter()
            .find(|p| p.id == Some(active_id))
            .map(|p| p.name.as_str())
            .unwrap_or("Unknown");
        format!("Focus: {}", name)
    } else {
        "Focus: None".to_string()
    };
    let focus_item  = MenuItem::with_id(app, "focus_label", &focus_label, false, None::<&str>)?;
    let sep1        = PredefinedMenuItem::separator(app)?;

    // ── Per-project check items ───────────────────────────────────
    let mut project_items: Vec<CheckMenuItem<tauri::Wry>> = Vec::new();
    for p in &projects {
        let pid = match p.id { Some(id) if id > 0 => id, _ => continue };
        let item = CheckMenuItem::with_id(
            app,
            &format!("project_{}", pid),
            &p.name,
            true,
            pid == active_id,
            None::<&str>,
        )?;
        project_items.push(item);
    }

    let clear        = MenuItem::with_id(app, "clear_focus", "Clear Focus", active_id > 0, None::<&str>)?;
    let sep2         = PredefinedMenuItem::separator(app)?;
    let pause_label  = if paused { "Resume Tracking" } else { "Pause Tracking" };
    let toggle_pause = MenuItem::with_id(app, "toggle_pause", pause_label, true, None::<&str>)?;
    let sep3         = PredefinedMenuItem::separator(app)?;
    let open         = MenuItem::with_id(app, "open", "Open Duskry", true, None::<&str>)?;
    let quit         = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    // ── Assemble ──────────────────────────────────────────────────
    let menu = Menu::new(app)?;
    menu.append(&focus_item)?;
    menu.append(&sep1)?;
    for item in &project_items {
        menu.append(item)?;
    }
    menu.append(&clear)?;
    menu.append(&sep2)?;
    menu.append(&toggle_pause)?;
    menu.append(&sep3)?;
    menu.append(&open)?;
    menu.append(&quit)?;

    Ok(menu)
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "open" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        "toggle_pause" => {
            let current = crate::tracker::TRACKING_PAUSED
                .load(std::sync::atomic::Ordering::SeqCst);
            let new_val = !current;
            crate::tracker::TRACKING_PAUSED
                .store(new_val, std::sync::atomic::Ordering::SeqCst);
            let _ = crate::db::set_setting(
                "tracking_paused",
                if new_val { "true" } else { "false" },
            );
            let _ = rebuild_tray(app);
        }
        "clear_focus" => {
            crate::tracker::ACTIVE_PROJECT_ID
                .store(0, std::sync::atomic::Ordering::SeqCst);
            let _ = crate::db::set_setting("active_project_id", "0");
            let _ = rebuild_tray(app);
        }
        "quit" => {
            app.exit(0);
        }
        other => {
            if let Some(pid_str) = other.strip_prefix("project_") {
                if let Ok(pid) = pid_str.parse::<i64>() {
                    crate::tracker::ACTIVE_PROJECT_ID
                        .store(pid, std::sync::atomic::Ordering::SeqCst);
                    let _ = crate::db::set_setting("active_project_id", &pid.to_string());
                    let _ = rebuild_tray(app);
                }
            }
        }
    }
}
