use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use chrono::Utc;
use hmac::{Hmac, Mac};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

type HmacSha256 = Hmac<Sha256>;

const CACHE_FILE: &str = "lc.bin";
const SEVEN_DAYS: i64 = 7 * 24 * 3600;
const INVALID_LICENSE_SETTING: &str = "license_invalid_message";
const LICENSE_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

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
    let cache = read_cache()?;
    if cache.machine_id != get_machine_id() {
        return None;
    }
    let expected = compute_hmac(&cache.key, &cache.machine_id);
    if cache.hmac != expected {
        return None;
    }
    Some(cache)
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

pub fn get_machine_id() -> String {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("ioreg")
            .args(["-d2", "-c", "IOPlatformExpertDevice"])
            .output()
            .ok();
        if let Some(o) = out {
            let s = String::from_utf8_lossy(&o.stdout);
            if let Some(uuid) = parse_platform_uuid(&s) {
                return hash_str(&uuid);
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
                return hash_str(&machine_guid);
            }
        }
    }
    hash_str(&format!("fallback-{}", std::env::consts::OS))
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
    std::fs::write(cache_path(), payload).map_err(|e| e.to_string())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn migrate_legacy_cache(
    data: &[u8],
    machine_id: &str,
    legacy_machine_id: &str,
) -> Option<LicenseCache> {
    let mut cache = decrypt_cache(data, legacy_machine_id)?;
    let valid_legacy_cache = cache.machine_id == legacy_machine_id
        && cache.hmac == compute_hmac(&cache.key, legacy_machine_id);
    if !valid_legacy_cache {
        return None;
    }

    cache.machine_id = machine_id.to_string();
    cache.hmac = compute_hmac(&cache.key, machine_id);
    // Migration must not extend the verification window; it only repairs
    // device identity and encryption for an already-known entitlement.
    let _ = write_encrypted_cache(&cache, machine_id);
    Some(cache)
}

fn read_cache() -> Option<LicenseCache> {
    let data = std::fs::read(cache_path()).ok()?;
    let machine_id = get_machine_id();
    if let Some(cache) = decrypt_cache(&data, &machine_id) {
        return Some(cache);
    }

    #[cfg(target_os = "macos")]
    {
        let legacy_machine_id = legacy_macos_machine_id();
        if let Some(cache) = migrate_legacy_cache(&data, &machine_id, &legacy_machine_id) {
            return Some(cache);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let legacy_machine_id = legacy_windows_machine_id();
        if let Some(cache) = migrate_legacy_cache(&data, &machine_id, &legacy_machine_id) {
            return Some(cache);
        }
    }

    None
}

pub fn write_cache_with_instance(
    key: &str,
    tier: &str,
    instance_id: Option<String>,
) -> Result<(), String> {
    let machine_id = get_machine_id();
    let cache = LicenseCache {
        key: key.to_string(),
        tier: tier.to_string(),
        valid_until: Utc::now().timestamp() + SEVEN_DAYS,
        last_verified_at: Utc::now().timestamp(),
        machine_id: machine_id.clone(),
        instance_id,
        hmac: compute_hmac(key, &machine_id),
    };
    write_encrypted_cache(&cache, &machine_id)
}

pub fn clear_cache() {
    let _ = std::fs::remove_file(cache_path());
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

fn tier_from_meta(meta: Option<&LSMeta>) -> Result<&'static str, String> {
    let meta = meta.ok_or_else(|| "The license response did not include a plan.".to_string())?;
    let variant = meta.variant_id.map(|id| id.to_string());
    if variant.as_deref().is_some_and(|id| {
        [
            option_env!("DUSKRY_VARIANT_PROPLUS_MONTHLY"),
            option_env!("DUSKRY_VARIANT_PROPLUS_YEARLY"),
        ]
        .into_iter()
        .flatten()
        .any(|configured| configured == id)
    }) {
        return Ok("proplus");
    }
    if variant.as_deref().is_some_and(|id| {
        [
            option_env!("DUSKRY_VARIANT_PRO_MONTHLY"),
            option_env!("DUSKRY_VARIANT_PRO_YEARLY"),
        ]
        .into_iter()
        .flatten()
        .any(|configured| configured == id)
    }) {
        return Ok("pro");
    }

    // Compatibility for local/dev builds made before variant IDs were required.
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
    if !response.status().is_success() {
        return Err(LicenseValidationError::Transient(format!(
            "License server returned {}.",
            response.status()
        )));
    }
    let body = response
        .json::<LSValidateResponse>()
        .await
        .map_err(|e| LicenseValidationError::Transient(e.to_string()))?;
    if !body.valid {
        let message = body
            .error
            .unwrap_or_else(|| "This license is no longer valid.".to_string());
        clear_cache();
        let _ = crate::db::set_setting(INVALID_LICENSE_SETTING, &message);
        return Err(LicenseValidationError::Invalid(message));
    }
    let tier = tier_from_meta(body.meta.as_ref()).map_err(LicenseValidationError::Transient)?;
    let instance_id = body
        .instance
        .map(|instance| instance.id)
        .or_else(|| cache.instance_id.clone());
    write_cache_with_instance(&cache.key, tier, instance_id)
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
    let Some(cache) = get_authenticated_cache() else {
        return Ok(get_effective_tier());
    };
    validate_existing(&cache).await
}

pub async fn refresh_license_status() -> LicenseStatus {
    let Some(cache) = get_authenticated_cache() else {
        return get_license_status();
    };

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
    if let Some(cache) = get_authenticated_cache()
        .filter(|cache| cache.key == license_key && cache.instance_id.is_some())
    {
        return validate_existing(&cache).await;
    }
    let client = reqwest::Client::new();
    let machine_id = get_machine_id();
    let resp = client
        .post("https://api.lemonsqueezy.com/v1/licenses/activate")
        .header("Accept", "application/json")
        .form(&[
            ("license_key", license_key),
            ("instance_name", machine_id.as_str()),
        ])
        .timeout(LICENSE_REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<LSActivateResponse>()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.activated {
        clear_cache();
        return Err(resp
            .error
            .unwrap_or_else(|| "Invalid license key".to_string()));
    }
    let tier = tier_from_meta(resp.meta.as_ref())?;
    let instance_id = resp.instance.map(|instance| instance.id);
    write_cache_with_instance(license_key, tier, instance_id)?;
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
    let Some(cache) = read_cache() else {
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
        assert_eq!(tier_from_meta(Some(&pro_plus)).unwrap(), "proplus");
        assert!(tier_from_meta(Some(&unknown)).is_err());
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
