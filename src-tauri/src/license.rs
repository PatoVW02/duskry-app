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

pub fn write_cache(key: &str, tier: &str) -> Result<(), String> {
    let machine_id = get_machine_id();
    let cache = LicenseCache {
        key: key.to_string(),
        tier: tier.to_string(),
        valid_until: Utc::now().timestamp() + SEVEN_DAYS,
        machine_id: machine_id.clone(),
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
pub struct LSValidateResponse {
    pub valid: bool,
    pub error: Option<String>,
    pub meta: Option<LSMeta>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LSMeta {
    pub product_name: String,
    pub variant_name: Option<String>,
    pub status: String,
}

pub async fn validate_license_online(license_key: &str) -> Result<AppTier, String> {
    let client = reqwest::Client::new();
    let machine_id = get_machine_id();
    let resp = client
        .post("https://api.lemonsqueezy.com/v1/licenses/validate")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "license_key": license_key,
            "instance_name": machine_id,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    let valid = resp["valid"].as_bool().unwrap_or(false);
    if !valid {
        clear_cache();
        return Err("Invalid license key".to_string());
    }
    let product = resp["meta"]["product_name"]
        .as_str()
        .unwrap_or("")
        .to_lowercase();
    let tier = if product.contains("pro+") || product.contains("proplus") {
        "proplus"
    } else {
        "pro"
    };
    write_cache(license_key, tier)?;
    Ok(if tier == "proplus" {
        AppTier::ProPlus
    } else {
        AppTier::Pro
    })
}
