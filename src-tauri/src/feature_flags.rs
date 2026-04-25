fn enabled(value: Option<String>, default_value: bool) -> bool {
    let Some(value) = value else {
        return default_value;
    };
    let value = value.trim().to_ascii_lowercase();
    if value.is_empty() {
        return default_value;
    }
    !matches!(value.as_str(), "0" | "false" | "off" | "no")
}

pub(crate) fn billing_plans_enabled() -> bool {
    let runtime = std::env::var("DUSKRY_BILLING_PLANS_ENABLED").ok();
    let compile_time = option_env!("DUSKRY_BILLING_PLANS_ENABLED").map(str::to_string);
    enabled(runtime.or(compile_time), true)
}
