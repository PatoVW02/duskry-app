use std::path::PathBuf;

const PROD_APP_DIR: &str = "duskry";
const DEV_APP_DIR: &str = "duskry-dev";

pub fn app_data_dir() -> PathBuf {
    let mut path = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push(app_storage_dir_name());
    std::fs::create_dir_all(&path).ok();
    path
}

pub fn app_data_file(name: &str) -> PathBuf {
    let mut path = app_data_dir();
    path.push(name);
    path
}

pub fn app_storage_dir_name() -> &'static str {
    if cfg!(debug_assertions) {
        DEV_APP_DIR
    } else {
        PROD_APP_DIR
    }
}
