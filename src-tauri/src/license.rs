use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use chrono::Utc;
use dirs::data_dir;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

type HmacSha256 = Hmac<Sha256>;

const CACHE_FILE: &str = "lc.bin";
const SEVEN_DAYS: i64 = 7 * 24 * 3600;

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

#[derive(Debug, Serialize, Deserialize)]
struct LicenseCache {
    key: String,
    tier: String,
    valid_until: i64,
    machine_id: String,
    instance_id: Option<String>,
    hmac: String,
}

pub fn get_effective_tier() -> AppTier {
    if let Some(tier) = get_valid_license_tier() {
        return match tier.as_str() {
            "pro" => AppTier::Pro,
            "proplus" | "pro+" => AppTier::ProPlus,
            _ => AppTier::Pro,
        };
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

fn get_valid_license_tier() -> Option<String> {
    let cache = read_cache()?;
    let now = Utc::now().timestamp();
    if cache.valid_until < now {
        return None;
    }
    if cache.machine_id != get_machine_id() {
        return None;
    }
    let expected = compute_hmac(&cache.key, &cache.machine_id);
    if cache.hmac != expected {
        return None;
    }
    Some(cache.tier)
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
            if let Some(start) = s.find("IOPlatformUUID") {
                let rest = &s[start..];
                if let Some(q1) = rest.find('"') {
                    let after = &rest[q1 + 1..];
                    if let Some(q2) = after.find('"') {
                        let uuid = &after[..q2];
                        return hash_str(uuid);
                    }
                }
            }
        }
    }
    hash_str(&format!("fallback-{}", std::env::consts::OS))
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
    let mut p = data_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("duskry");
    std::fs::create_dir_all(&p).ok();
    p.push(CACHE_FILE);
    p
}

fn read_cache() -> Option<LicenseCache> {
    let data = std::fs::read(cache_path()).ok()?;
    let machine_id = get_machine_id();
    let raw_key = derive_key(&machine_id);
    let key = Key::<Aes256Gcm>::from_slice(&raw_key);
    let cipher = Aes256Gcm::new(key);
    let nonce_bytes = b"duskry-nonce";
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher.decrypt(nonce, data.as_ref()).ok()?;
    serde_json::from_slice(&plaintext).ok()
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
        machine_id: machine_id.clone(),
        instance_id,
        hmac: compute_hmac(key, &machine_id),
    };
    let raw_key = derive_key(&machine_id);
    let aes_key = Key::<Aes256Gcm>::from_slice(&raw_key);
    let cipher = Aes256Gcm::new(aes_key);
    let nonce_bytes = b"duskry-nonce";
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = serde_json::to_vec(&cache).map_err(|e| e.to_string())?;
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| e.to_string())?;
    std::fs::write(cache_path(), ciphertext).map_err(|e| e.to_string())
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
    pub product_name: String,
    pub variant_name: Option<String>,
}

pub async fn validate_license_online(license_key: &str) -> Result<AppTier, String> {
    let client = reqwest::Client::new();
    let machine_id = get_machine_id();
    let resp = client
        .post("https://api.lemonsqueezy.com/v1/licenses/activate")
        .header("Accept", "application/json")
        .form(&[
            ("license_key", license_key),
            ("instance_name", machine_id.as_str()),
        ])
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
    let plan_label = resp
        .meta
        .as_ref()
        .map(|meta| {
            format!(
                "{} {}",
                meta.product_name,
                meta.variant_name.as_deref().unwrap_or("")
            )
        })
        .unwrap_or_default()
        .to_lowercase();
    let tier = if plan_label.contains("pro+") || plan_label.contains("proplus") {
        "proplus"
    } else {
        "pro"
    };
    let instance_id = resp.instance.map(|instance| instance.id);
    write_cache_with_instance(license_key, tier, instance_id)?;
    Ok(if tier == "proplus" {
        AppTier::ProPlus
    } else {
        AppTier::Pro
    })
}

pub fn cached_license_can_deactivate() -> bool {
    read_cache()
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
        .send()
        .await
        .map_err(|e| format!("Could not reach Lemon Squeezy: {e}"))?;

    let status = response.status();
    if status.is_server_error() {
        return Err("Lemon Squeezy is temporarily unavailable. Please try again.".to_string());
    }

    if status.is_client_error() {
        clear_cache();
        return Ok(AppTier::Free);
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
        Ok(AppTier::Free)
    } else {
        Err(body["error"]
            .as_str()
            .unwrap_or("Could not deactivate this license. Please try again.")
            .to_string())
    }
}
