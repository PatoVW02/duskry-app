use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use chrono::Utc;
use hmac::{Hmac, Mac};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};

type HmacSha256 = Hmac<Sha256>;

const CACHE_FILE: &str = "lc.bin";
const MACHINE_ID_FILE: &str = "machine-id";
const SEVEN_DAYS: i64 = 7 * 24 * 3600;
const MIN_ONLINE_REFRESH_INTERVAL: i64 = 5 * 60;
const INVALID_LICENSE_SETTING: &str = "license_invalid_message";
const LICENSE_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
static LICENSE_OPERATION_LOCK: once_cell::sync::Lazy<tokio::sync::Mutex<()>> =
    once_cell::sync::Lazy::new(|| tokio::sync::Mutex::new(()));

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MachineIdentityOrigin {
    Persisted,
    Hardware,
    CompatibilityFallback,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MachineIdentity {
    value: String,
    origin: MachineIdentityOrigin,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum AppTier {
    Free,
    ProTrial,
    Pro,
    ProPlus,
    Expired,
}

impl AppTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            AppTier::Free => "free",
            AppTier::ProTrial => "proTrial",
            AppTier::Pro => "pro",
            AppTier::ProPlus => "proPlus",
            AppTier::Expired => "expired",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct LicenseCache {
    key: String,
    tier: String,
    valid_until: i64,
    #[serde(default)]
    last_verified_at: i64,
    machine_id: String,
    instance_id: Option<String>,
    hmac: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    pub tier: String,
    pub verification_state: String,
    pub last_verified_at: Option<i64>,
    pub offline_grace_until: Option<i64>,
    pub message: Option<String>,
}

#[derive(Debug)]
enum LicenseValidationError {
    Invalid(String),
    Transient(String),
}

impl LicenseValidationError {
    fn message(self) -> String {
        match self {
            Self::Invalid(message) | Self::Transient(message) => message,
        }
    }
}

pub fn get_effective_tier() -> AppTier {
    // An elapsed online-verification window is not evidence that a paid
    // subscription was cancelled. Keep the authenticated last-known plan and
    // let `refresh_license_status` distinguish offline/verification-needed
    // states. Only an explicit invalid response clears the cache.
    if let Some(cache) = get_authenticated_cache() {
        return app_tier(&cache.tier);
    }

    let trial_status = crate::db::get_setting("trial_status").unwrap_or_default();
    let trial_expires = crate::db::get_setting("trial_expires_at")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    let now = Utc::now().timestamp();

    match trial_status.as_str() {
        "active" if now < trial_expires => AppTier::ProTrial,
        "active" => {
            let _ = crate::db::set_setting("trial_status", "expired");
            AppTier::Expired
        }
        "expired" => AppTier::Expired,
        _ => AppTier::Free,
    }
}

fn get_authenticated_cache() -> Option<LicenseCache> {
    let payloads = read_cache_payloads();
    if payloads.is_empty() {
        return None;
    }

    let persisted = read_persisted_machine_id();
    if let Some(machine_id) = persisted.as_deref() {
        if let Some(cache) = authenticated_cache_for_identity(&payloads, machine_id) {
            return Some(cache);
        }
    }

    // A persisted identity normally avoids all OS lookups. Hardware is queried
    // only as a recovery candidate when the persisted ID cannot open the cache.
    let hardware = hardware_machine_id();
    if let Some(machine_id) = hardware.as_deref() {
        if persisted.as_deref() != Some(machine_id) {
            if let Some(cache) = authenticated_cache_for_identity(&payloads, machine_id) {
                // Authentication proves that this is the identity the existing cache
                // was written with. Persist only after that proof succeeds.
                let _ = persist_machine_id(machine_id);
                return Some(cache);
            }
        }
    }

    for compatibility_id in compatibility_machine_ids() {
        if persisted.as_deref() == Some(compatibility_id.as_str())
            || hardware.as_deref() == Some(compatibility_id.as_str())
        {
            continue;
        }
        let Some(cache) = authenticated_cache_for_identity(&payloads, &compatibility_id) else {
            continue;
        };

        // Old macOS parser IDs and OS-wide fallbacks remain readable. Migrate
        // only when a real hardware identity is currently available; otherwise
        // keep using the recoverable old cache without persisting the fallback.
        if let Some(target) = hardware.as_deref() {
            if persist_machine_id(target).is_ok() {
                let mut migrated = cache.clone();
                migrated.machine_id = target.to_string();
                migrated.hmac = compute_hmac(&migrated.key, target);
                if write_encrypted_cache(&migrated, target).is_ok() {
                    return Some(migrated);
                }
            }
        }
        return Some(cache);
    }

    None
}

fn cache_last_verified_at(cache: &LicenseCache) -> i64 {
    if cache.last_verified_at > 0 {
        cache.last_verified_at
    } else {
        // Cache files written before this field was introduced used a fixed
        // seven-day verification window, so the timestamp can be recovered.
        cache.valid_until.saturating_sub(SEVEN_DAYS)
    }
}

fn should_refresh_online(last_verified_at: i64, now: i64) -> bool {
    last_verified_at <= 0
        || now < last_verified_at
        || now.saturating_sub(last_verified_at) >= MIN_ONLINE_REFRESH_INTERVAL
}

fn cache_verification_state(valid_until: i64, now: i64, refresh_failed: bool) -> &'static str {
    if now <= valid_until {
        if refresh_failed {
            "offline-grace"
        } else {
            "active"
        }
    } else {
        "verification-needed"
    }
}

fn is_definitive_license_api_error(status: u16) -> bool {
    matches!(status, 400 | 404 | 422)
}

fn license_api_error_message(body: &str, fallback: String) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| value["error"].as_str().map(str::trim).map(str::to_string))
        .filter(|message| !message.is_empty())
        .unwrap_or(fallback)
}

fn record_invalid_license(message: &str) {
    clear_cache();
    let _ = crate::db::set_setting(INVALID_LICENSE_SETTING, message);
}

fn paid_cache_status(
    cache: &LicenseCache,
    verification_state: &str,
    message: Option<String>,
) -> LicenseStatus {
    LicenseStatus {
        tier: app_tier(&cache.tier).as_str().to_string(),
        verification_state: verification_state.to_string(),
        last_verified_at: Some(cache_last_verified_at(cache)),
        offline_grace_until: Some(cache.valid_until),
        message,
    }
}

pub fn get_license_status() -> LicenseStatus {
    if let Some(cache) = get_authenticated_cache() {
        let verification_state =
            cache_verification_state(cache.valid_until, Utc::now().timestamp(), false);
        return paid_cache_status(&cache, verification_state, None);
    }

    let tier = get_effective_tier();
    let invalid_message = crate::db::get_setting(INVALID_LICENSE_SETTING)
        .filter(|message| !message.trim().is_empty());
    LicenseStatus {
        tier: tier.as_str().to_string(),
        verification_state: if invalid_message.is_some() {
            "invalid".to_string()
        } else {
            "active".to_string()
        },
        last_verified_at: None,
        offline_grace_until: None,
        message: invalid_message,
    }
}

fn normalized_persisted_machine_id(raw: &str) -> Option<String> {
    let value = raw.trim();
    (value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| value.to_ascii_lowercase())
}

fn select_machine_identity(
    persisted: Option<String>,
    hardware: Option<String>,
    compatibility_fallback: String,
) -> MachineIdentity {
    if let Some(value) = persisted {
        return MachineIdentity {
            value,
            origin: MachineIdentityOrigin::Persisted,
        };
    }
    if let Some(value) = hardware {
        return MachineIdentity {
            value,
            origin: MachineIdentityOrigin::Hardware,
        };
    }
    MachineIdentity {
        value: compatibility_fallback,
        origin: MachineIdentityOrigin::CompatibilityFallback,
    }
}

fn persisted_machine_id_path() -> PathBuf {
    crate::paths::app_data_file(MACHINE_ID_FILE)
}

fn read_persisted_machine_id() -> Option<String> {
    let value = std::fs::read_to_string(persisted_machine_id_path()).ok()?;
    normalized_persisted_machine_id(&value)
}

fn persist_machine_id(machine_id: &str) -> Result<(), String> {
    let normalized = normalized_persisted_machine_id(machine_id)
        .ok_or_else(|| "The machine identity is invalid.".to_string())?;
    write_file_atomically(&persisted_machine_id_path(), normalized.as_bytes())
}

fn os_fallback_machine_id() -> String {
    hash_str(&format!("fallback-{}", std::env::consts::OS))
}

fn hardware_machine_id() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("ioreg")
            .args(["-d2", "-c", "IOPlatformExpertDevice"])
            .output()
            .ok();
        if let Some(o) = out {
            let s = String::from_utf8_lossy(&o.stdout);
            if let Some(uuid) = parse_platform_uuid(&s) {
                return Some(hash_str(&uuid));
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let out = std::process::Command::new("reg")
            .args([
                "query",
                r"HKLM\SOFTWARE\Microsoft\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .output()
            .ok();
        if let Some(o) = out {
            let s = String::from_utf8_lossy(&o.stdout);
            if let Some(machine_guid) = parse_windows_machine_guid(&s) {
                return Some(hash_str(&machine_guid));
            }
        }
    }
    None
}

fn current_machine_identity() -> MachineIdentity {
    // Avoid invoking ioreg/reg in the normal case once a validated identity has
    // been persisted by an authenticated cache read or successful cache write.
    if let Some(persisted) = read_persisted_machine_id() {
        return select_machine_identity(Some(persisted), None, os_fallback_machine_id());
    }
    select_machine_identity(None, hardware_machine_id(), os_fallback_machine_id())
}

#[cfg(any(target_os = "macos", test))]
fn parse_platform_uuid(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        if !line.contains("IOPlatformUUID") {
            return None;
        }
        let (_, raw_value) = line.split_once('=')?;
        let uuid = raw_value.trim().trim_matches('"');
        (!uuid.is_empty()).then(|| uuid.to_string())
    })
}

#[cfg(any(target_os = "windows", test))]
fn parse_windows_machine_guid(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        if !line.to_ascii_lowercase().contains("machineguid") {
            return None;
        }
        let value = line.split_whitespace().last()?;
        (!value.eq_ignore_ascii_case("machineguid") && !value.eq_ignore_ascii_case("reg_sz"))
            .then(|| value.to_string())
    })
}

#[cfg(target_os = "macos")]
fn legacy_macos_machine_id() -> String {
    // Before 1.0.8 the UUID parser accidentally extracted the text between
    // the key's closing quote and the value's opening quote: ` = `. This
    // fallback lets us decrypt and migrate existing customer caches once.
    hash_str(" = ")
}

#[cfg(target_os = "windows")]
fn legacy_windows_machine_id() -> String {
    // Windows previously fell through to an OS-wide constant instead of a
    // device identifier. Keep a one-time decrypt path for those cache files.
    hash_str("fallback-windows")
}

fn hash_str(s: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    hex::encode(hasher.finalize())
}

fn compute_hmac(key: &str, machine_id: &str) -> String {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(machine_id.as_bytes()).expect("HMAC init");
    mac.update(key.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

fn derive_key(machine_id: &str) -> [u8; 32] {
    let salt = b"duskry-license-v1";
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(machine_id.as_bytes(), salt, 100_000, &mut key);
    key
}

fn cache_path() -> PathBuf {
    crate::paths::app_data_file(CACHE_FILE)
}

fn cache_backup_path() -> PathBuf {
    crate::paths::app_data_file(&format!("{CACHE_FILE}.bak"))
}

fn cache_storage_exists() -> bool {
    cache_path().exists() || cache_backup_path().exists()
}

#[cfg(unix)]
fn make_file_private(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())
}

#[cfg(not(unix))]
fn make_file_private(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn write_file_atomically(path: &Path, payload: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "License cache path has no parent directory.".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "License cache filename is invalid.".to_string())?;
    let mut random = [0_u8; 8];
    OsRng.fill_bytes(&mut random);
    let temp_path = parent.join(format!(".{file_name}.{}.tmp", hex::encode(random)));

    let write_result = (|| -> Result<(), String> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temp_path)
            .map_err(|error| error.to_string())?;
        file.write_all(payload).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);

        #[cfg(target_os = "windows")]
        if path.exists() {
            std::fs::remove_file(path).map_err(|error| error.to_string())?;
        }
        std::fs::rename(&temp_path, path).map_err(|error| error.to_string())?;
        make_file_private(path)?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    write_result
}

fn write_payload_recoverably(
    path: &Path,
    backup_path: &Path,
    payload: &[u8],
) -> Result<(), String> {
    // Write the recovery copy first. A crash during the primary replacement can
    // therefore recover either the previous primary or this complete new copy.
    write_file_atomically(backup_path, payload)?;
    write_file_atomically(path, payload)
}

fn decrypt_cache(data: &[u8], machine_id: &str) -> Option<LicenseCache> {
    let raw_key = derive_key(machine_id);
    let key = Key::<Aes256Gcm>::from_slice(&raw_key);
    let cipher = Aes256Gcm::new(key);
    // Current format is nonce || ciphertext. Fall back to the pre-1.0.7
    // fixed-nonce format so existing customers can migrate on refresh.
    let plaintext = if data.len() > 12 {
        cipher
            .decrypt(Nonce::from_slice(&data[..12]), &data[12..])
            .ok()
    } else {
        None
    }
    .or_else(|| {
        cipher
            .decrypt(Nonce::from_slice(b"duskry-nonce"), data.as_ref())
            .ok()
    })?;
    serde_json::from_slice(&plaintext).ok()
}

fn read_cache_payloads() -> Vec<Vec<u8>> {
    [cache_path(), cache_backup_path()]
        .into_iter()
        .filter_map(|path| std::fs::read(path).ok())
        .collect()
}

fn authenticated_cache_for_identity(
    payloads: &[Vec<u8>],
    machine_id: &str,
) -> Option<LicenseCache> {
    payloads.iter().find_map(|data| {
        let cache = decrypt_cache(data, machine_id)?;
        let authenticated =
            cache.machine_id == machine_id && cache.hmac == compute_hmac(&cache.key, machine_id);
        authenticated.then_some(cache)
    })
}

fn compatibility_machine_ids() -> Vec<String> {
    let mut identities = vec![os_fallback_machine_id()];
    #[cfg(target_os = "macos")]
    identities.push(legacy_macos_machine_id());
    #[cfg(target_os = "windows")]
    identities.push(legacy_windows_machine_id());
    identities.sort();
    identities.dedup();
    identities
}

fn write_encrypted_cache(cache: &LicenseCache, machine_id: &str) -> Result<(), String> {
    let raw_key = derive_key(machine_id);
    let aes_key = Key::<Aes256Gcm>::from_slice(&raw_key);
    let cipher = Aes256Gcm::new(aes_key);
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = serde_json::to_vec(cache).map_err(|e| e.to_string())?;
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| e.to_string())?;
    let mut payload = nonce_bytes.to_vec();
    payload.extend(ciphertext);
    write_payload_recoverably(&cache_path(), &cache_backup_path(), &payload)
}

fn write_cache_with_identity(
    key: &str,
    tier: &str,
    instance_id: Option<String>,
    machine_id: &str,
) -> Result<(), String> {
    let cache = LicenseCache {
        key: key.to_string(),
        tier: tier.to_string(),
        valid_until: Utc::now().timestamp() + SEVEN_DAYS,
        last_verified_at: Utc::now().timestamp(),
        machine_id: machine_id.to_string(),
        instance_id,
        hmac: compute_hmac(key, machine_id),
    };
    write_encrypted_cache(&cache, machine_id)
}

fn write_cache_with_selected_identity(
    key: &str,
    tier: &str,
    instance_id: Option<String>,
    identity: &MachineIdentity,
) -> Result<(), String> {
    write_cache_with_identity(key, tier, instance_id, &identity.value)?;
    // A hardware-derived ID becomes persistent only after the encrypted cache
    // is fully written. OS-wide compatibility fallbacks intentionally remain
    // unpersisted so a later successful hardware lookup can migrate them.
    if identity.origin == MachineIdentityOrigin::Hardware {
        if let Err(error) = persist_machine_id(&identity.value) {
            // The authenticated cache is already durable and remains readable
            // through the hardware ID. Do not report activation failure after
            // the server has succeeded; a later authenticated read retries it.
            crate::logger::tlog(&format!(
                "Could not persist the authenticated machine identity: {error}"
            ));
        }
    }
    Ok(())
}

pub fn clear_cache() {
    let _ = std::fs::remove_file(cache_path());
    let _ = std::fs::remove_file(cache_backup_path());
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LSActivateResponse {
    pub activated: bool,
    pub error: Option<String>,
    pub instance: Option<LSInstance>,
    pub meta: Option<LSMeta>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LSInstance {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LSMeta {
    #[serde(default)]
    pub product_name: String,
    #[serde(default)]
    pub variant_name: Option<String>,
    #[serde(default)]
    pub variant_id: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LSValidateResponse {
    valid: bool,
    error: Option<String>,
    instance: Option<LSInstance>,
    meta: Option<LSMeta>,
}

fn configured_variant_ids(values: &[Option<&'static str>]) -> Vec<&'static str> {
    values
        .iter()
        .flatten()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect()
}

fn tier_from_meta_with_variants(
    meta: Option<&LSMeta>,
    pro_variants: &[&str],
    pro_plus_variants: &[&str],
    allow_legacy_labels: bool,
) -> Result<&'static str, String> {
    let meta = meta.ok_or_else(|| "The license response did not include a plan.".to_string())?;
    let variant = meta.variant_id.map(|id| id.to_string());
    if variant
        .as_deref()
        .is_some_and(|id| pro_plus_variants.contains(&id))
    {
        return Ok("proplus");
    }
    if variant
        .as_deref()
        .is_some_and(|id| pro_variants.contains(&id))
    {
        return Ok("pro");
    }

    // Production builds fail closed. Label matching is retained only for local
    // debug compatibility when no authoritative variant IDs were configured.
    if !allow_legacy_labels || !pro_variants.is_empty() || !pro_plus_variants.is_empty() {
        return Err(
            "This license belongs to an unknown Duskry plan. Please contact support.".to_string(),
        );
    }
    let label = format!(
        "{} {}",
        meta.product_name,
        meta.variant_name.as_deref().unwrap_or("")
    );
    let label = label.to_lowercase();
    if label.contains("pro+") || label.contains("proplus") || label.contains("pro plus") {
        Ok("proplus")
    } else if label.contains("pro") {
        Ok("pro")
    } else {
        Err("This license belongs to an unknown Duskry plan. Please contact support.".to_string())
    }
}

fn tier_from_meta(meta: Option<&LSMeta>) -> Result<&'static str, String> {
    let pro_variants = configured_variant_ids(&[
        option_env!("DUSKRY_VARIANT_PRO_MONTHLY"),
        option_env!("DUSKRY_VARIANT_PRO_YEARLY"),
    ]);
    let pro_plus_variants = configured_variant_ids(&[
        option_env!("DUSKRY_VARIANT_PROPLUS_MONTHLY"),
        option_env!("DUSKRY_VARIANT_PROPLUS_YEARLY"),
    ]);
    tier_from_meta_with_variants(
        meta,
        &pro_variants,
        &pro_plus_variants,
        cfg!(debug_assertions),
    )
}

fn app_tier(tier: &str) -> AppTier {
    if tier == "proplus" {
        AppTier::ProPlus
    } else {
        AppTier::Pro
    }
}

async fn validate_existing_detailed(
    cache: &LicenseCache,
) -> Result<AppTier, LicenseValidationError> {
    let mut form = vec![("license_key", cache.key.as_str())];
    if let Some(instance_id) = cache.instance_id.as_deref() {
        form.push(("instance_id", instance_id));
    }
    let response = reqwest::Client::new()
        .post("https://api.lemonsqueezy.com/v1/licenses/validate")
        .header("Accept", "application/json")
        .form(&form)
        .timeout(LICENSE_REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| {
            LicenseValidationError::Transient(format!("Could not reach Lemon Squeezy: {e}"))
        })?;
    let status = response.status();
    if !status.is_success() {
        let fallback = format!("License server returned {status}.");
        let response_body = response.text().await.unwrap_or_default();
        let message = license_api_error_message(&response_body, fallback);
        if is_definitive_license_api_error(status.as_u16()) {
            record_invalid_license(&message);
            return Err(LicenseValidationError::Invalid(message));
        }
        return Err(LicenseValidationError::Transient(message));
    }
    let body = response
        .json::<LSValidateResponse>()
        .await
        .map_err(|e| LicenseValidationError::Transient(e.to_string()))?;
    if !body.valid {
        let message = body
            .error
            .unwrap_or_else(|| "This license is no longer valid.".to_string());
        record_invalid_license(&message);
        return Err(LicenseValidationError::Invalid(message));
    }
    let tier = match tier_from_meta(body.meta.as_ref()) {
        Ok(tier) => tier,
        Err(message) => {
            // A successful validation for a different configured variant is a
            // deterministic entitlement mismatch, not a temporary outage.
            record_invalid_license(&message);
            return Err(LicenseValidationError::Invalid(message));
        }
    };
    let instance_id = body
        .instance
        .map(|instance| instance.id)
        .or_else(|| cache.instance_id.clone());
    // Refresh using the already-authenticated identity. In particular, an old
    // compatibility cache must not be rebound to a transient OS-wide fallback.
    write_cache_with_identity(&cache.key, tier, instance_id, &cache.machine_id)
        .map_err(LicenseValidationError::Transient)?;
    let _ = crate::db::set_setting(INVALID_LICENSE_SETTING, "");
    Ok(app_tier(tier))
}

async fn validate_existing(cache: &LicenseCache) -> Result<AppTier, String> {
    validate_existing_detailed(cache)
        .await
        .map_err(LicenseValidationError::message)
}

pub async fn refresh_license_online() -> Result<AppTier, String> {
    let _operation = LICENSE_OPERATION_LOCK.lock().await;
    let Some(cache) = get_authenticated_cache() else {
        return Ok(get_effective_tier());
    };
    if !should_refresh_online(cache_last_verified_at(&cache), Utc::now().timestamp()) {
        return Ok(app_tier(&cache.tier));
    }
    validate_existing(&cache).await
}

pub async fn refresh_license_status() -> LicenseStatus {
    let _operation = LICENSE_OPERATION_LOCK.lock().await;
    let Some(cache) = get_authenticated_cache() else {
        return get_license_status();
    };
    if !should_refresh_online(cache_last_verified_at(&cache), Utc::now().timestamp()) {
        return get_license_status();
    }

    match validate_existing_detailed(&cache).await {
        Ok(_) => get_license_status(),
        Err(LicenseValidationError::Invalid(message)) => {
            let mut status = get_license_status();
            status.verification_state = "invalid".to_string();
            status.last_verified_at = Some(cache_last_verified_at(&cache));
            status.offline_grace_until = Some(cache.valid_until);
            status.message = Some(message);
            status
        }
        Err(LicenseValidationError::Transient(message)) => {
            let state = cache_verification_state(cache.valid_until, Utc::now().timestamp(), true);
            paid_cache_status(&cache, state, Some(message))
        }
    }
}

pub async fn validate_license_online(license_key: &str) -> Result<AppTier, String> {
    let _operation = LICENSE_OPERATION_LOCK.lock().await;
    let license_key = license_key.trim();
    if license_key.is_empty() {
        return Err("Enter a license key.".to_string());
    }
    let existing_cache = get_authenticated_cache();
    if let Some(cache) = existing_cache
        .as_ref()
        .filter(|cache| cache.key == license_key && cache.instance_id.is_some())
    {
        return validate_existing(cache).await;
    }
    let identity = current_machine_identity();
    if existing_cache.is_none()
        && cache_storage_exists()
        && identity.origin == MachineIdentityOrigin::CompatibilityFallback
    {
        return Err(
            "Duskry could not read the device identity needed for the existing license. Try again after restarting the app."
                .to_string(),
        );
    }
    let client = reqwest::Client::new();
    let response = client
        .post("https://api.lemonsqueezy.com/v1/licenses/activate")
        .header("Accept", "application/json")
        .form(&[
            ("license_key", license_key),
            ("instance_name", identity.value.as_str()),
        ])
        .timeout(LICENSE_REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("Could not reach Lemon Squeezy: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let message = response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|body| body["error"].as_str().map(str::to_string))
            .unwrap_or_else(|| format!("License server returned {status}."));
        return Err(message);
    }
    let resp = response
        .json::<LSActivateResponse>()
        .await
        .map_err(|e| format!("License server returned an invalid response: {e}"))?;

    if !resp.activated {
        return Err(resp
            .error
            .unwrap_or_else(|| "Invalid license key".to_string()));
    }
    let tier = tier_from_meta(resp.meta.as_ref())?;
    let instance_id = resp.instance.map(|instance| instance.id);
    write_cache_with_selected_identity(license_key, tier, instance_id, &identity)?;
    let _ = crate::db::set_setting(INVALID_LICENSE_SETTING, "");
    Ok(app_tier(tier))
}

pub fn cached_license_can_deactivate() -> bool {
    get_authenticated_cache()
        .and_then(|cache| cache.instance_id)
        .map(|instance_id| !instance_id.is_empty())
        .unwrap_or(false)
}

pub async fn remove_license_online() -> Result<AppTier, String> {
    let _operation = LICENSE_OPERATION_LOCK.lock().await;
    let Some(cache) = get_authenticated_cache() else {
        clear_cache();
        return Ok(AppTier::Free);
    };

    let Some(instance_id) = cache.instance_id.as_deref().filter(|id| !id.is_empty()) else {
        clear_cache();
        return Ok(AppTier::Free);
    };

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.lemonsqueezy.com/v1/licenses/deactivate")
        .header("Accept", "application/json")
        .form(&[
            ("license_key", cache.key.as_str()),
            ("instance_id", instance_id),
        ])
        .timeout(LICENSE_REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("Could not reach Lemon Squeezy: {e}"))?;

    let status = response.status();
    if status.is_server_error() {
        return Err("Lemon Squeezy is temporarily unavailable. Please try again.".to_string());
    }

    if status.as_u16() == 404 || status.as_u16() == 422 {
        clear_cache();
        return Ok(AppTier::Free);
    }
    if status.is_client_error() {
        return Err(format!(
            "Could not deactivate the license ({}). Please try again.",
            status
        ));
    }

    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;
    let deactivated = body["deactivated"].as_bool().unwrap_or(false);
    let already_removed = body["error"]
        .as_str()
        .map(|error| {
            let error = error.to_lowercase();
            error.contains("not found")
                || error.contains("invalid")
                || error.contains("inactive")
                || error.contains("deactivated")
        })
        .unwrap_or(false);

    if deactivated || already_removed {
        clear_cache();
        let _ = crate::db::set_setting(INVALID_LICENSE_SETTING, "");
        Ok(AppTier::Free)
    } else {
        Err(body["error"]
            .as_str()
            .unwrap_or("Could not deactivate this license. Please try again.")
            .to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_legacy_plan_labels_without_guessing_unknown_plans() {
        let pro_plus = LSMeta {
            product_name: "Duskry".into(),
            variant_name: Some("Pro+ Yearly".into()),
            variant_id: None,
        };
        let unknown = LSMeta {
            product_name: "Duskry".into(),
            variant_name: Some("Starter".into()),
            variant_id: None,
        };
        assert_eq!(
            tier_from_meta_with_variants(Some(&pro_plus), &[], &[], true).unwrap(),
            "proplus"
        );
        assert!(tier_from_meta_with_variants(Some(&unknown), &[], &[], true).is_err());
    }

    #[test]
    fn configured_variant_ids_are_authoritative() {
        let matching = LSMeta {
            product_name: "Duskry".into(),
            variant_name: Some("Pro+ Yearly".into()),
            variant_id: Some(400),
        };
        let foreign_pro_label = LSMeta {
            product_name: "Another Product".into(),
            variant_name: Some("Professional".into()),
            variant_id: Some(999),
        };

        assert_eq!(
            tier_from_meta_with_variants(Some(&matching), &["100", "200"], &["300", "400"], false,)
                .unwrap(),
            "proplus"
        );
        assert!(tier_from_meta_with_variants(
            Some(&foreign_pro_label),
            &["100", "200"],
            &["300", "400"],
            true,
        )
        .is_err());
    }

    #[test]
    fn deterministic_license_api_errors_are_invalid_but_outages_remain_transient() {
        for status in [400, 404, 422] {
            assert!(is_definitive_license_api_error(status));
        }
        for status in [401, 408, 409, 429, 500, 502, 503] {
            assert!(!is_definitive_license_api_error(status));
        }
    }

    #[test]
    fn license_api_error_message_prefers_the_documented_error_field() {
        assert_eq!(
            license_api_error_message(
                r#"{"error":"This license instance was not found."}"#,
                "fallback".to_string(),
            ),
            "This license instance was not found."
        );
        assert_eq!(
            license_api_error_message("not json", "fallback".to_string()),
            "fallback"
        );
    }

    #[test]
    fn recoverable_cache_write_keeps_complete_primary_and_backup_files() {
        let mut random = [0_u8; 8];
        OsRng.fill_bytes(&mut random);
        let directory = std::env::temp_dir().join(format!(
            "duskry-license-cache-test-{}-{}",
            std::process::id(),
            hex::encode(random)
        ));
        std::fs::create_dir_all(&directory).expect("test directory");
        let primary = directory.join("lc.bin");
        let backup = directory.join("lc.bin.bak");

        write_payload_recoverably(&primary, &backup, b"first").expect("first write");
        write_payload_recoverably(&primary, &backup, b"second").expect("second write");
        assert_eq!(std::fs::read(&primary).unwrap(), b"second");
        assert_eq!(std::fs::read(&backup).unwrap(), b"second");

        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn preserves_paid_plan_when_online_verification_is_unavailable() {
        let cache = LicenseCache {
            key: "test-key".into(),
            tier: "proplus".into(),
            valid_until: 100,
            last_verified_at: 50,
            machine_id: "machine".into(),
            instance_id: Some("instance".into()),
            hmac: "signature".into(),
        };

        let within_grace = paid_cache_status(
            &cache,
            cache_verification_state(cache.valid_until, 75, true),
            Some("offline".into()),
        );
        assert_eq!(within_grace.tier, "proPlus");
        assert_eq!(within_grace.verification_state, "offline-grace");
        assert_eq!(within_grace.last_verified_at, Some(50));

        let after_grace = paid_cache_status(
            &cache,
            cache_verification_state(cache.valid_until, 101, true),
            Some("offline".into()),
        );
        assert_eq!(after_grace.tier, "proPlus");
        assert_eq!(after_grace.verification_state, "verification-needed");
    }

    #[test]
    fn throttles_recent_refreshes_but_rechecks_after_clock_changes() {
        assert!(!should_refresh_online(1_000, 1_299));
        assert!(should_refresh_online(1_000, 1_300));
        assert!(should_refresh_online(1_000, 999));
        assert!(should_refresh_online(0, 100));
    }

    #[test]
    fn persisted_machine_ids_require_a_complete_sha256_hex_value() {
        let uppercase = "A".repeat(64);
        assert_eq!(
            normalized_persisted_machine_id(&format!("  {uppercase}\n")),
            Some("a".repeat(64))
        );
        assert!(normalized_persisted_machine_id(&"a".repeat(63)).is_none());
        assert!(normalized_persisted_machine_id(&format!("{}g", "a".repeat(63))).is_none());
        assert!(normalized_persisted_machine_id("fallback-macos").is_none());
    }

    #[test]
    fn persisted_identity_wins_then_hardware_then_unpersisted_fallback() {
        let persisted = "1".repeat(64);
        let hardware = "2".repeat(64);
        let fallback = "3".repeat(64);

        assert_eq!(
            select_machine_identity(
                Some(persisted.clone()),
                Some(hardware.clone()),
                fallback.clone(),
            ),
            MachineIdentity {
                value: persisted,
                origin: MachineIdentityOrigin::Persisted,
            }
        );
        assert_eq!(
            select_machine_identity(None, Some(hardware.clone()), fallback.clone()),
            MachineIdentity {
                value: hardware,
                origin: MachineIdentityOrigin::Hardware,
            }
        );
        assert_eq!(
            select_machine_identity(None, None, fallback.clone()),
            MachineIdentity {
                value: fallback,
                origin: MachineIdentityOrigin::CompatibilityFallback,
            }
        );
    }

    #[test]
    fn parses_the_platform_uuid_value_instead_of_the_separator() {
        let output = r###"        "IOPlatformUUID" = "AEDC17E8-2951-5DBB-8BEF-B696C2316434""###;
        assert_eq!(
            parse_platform_uuid(output).as_deref(),
            Some("AEDC17E8-2951-5DBB-8BEF-B696C2316434")
        );
    }

    #[test]
    fn parses_the_windows_machine_guid_value() {
        let output = r#"    MachineGuid    REG_SZ    68f8d677-87c2-4f8d-a54a-736785c6caa0"#;
        assert_eq!(
            parse_windows_machine_guid(output).as_deref(),
            Some("68f8d677-87c2-4f8d-a54a-736785c6caa0")
        );
    }
}
