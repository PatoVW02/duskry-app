pub fn validated_details(name: &str, color: &str) -> Result<(String, String), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Enter a project name.".into());
    }
    let hex = color.trim().strip_prefix('#').unwrap_or(color.trim());
    if !matches!(hex.len(), 3 | 6) || !hex.chars().all(|digit| digit.is_ascii_hexdigit()) {
        return Err("Enter a valid hex color, such as #A855F7 or #ABC.".into());
    }
    let hex = if hex.len() == 3 {
        hex.chars()
            .flat_map(|digit| [digit, digit])
            .collect::<String>()
    } else {
        hex.to_string()
    };
    Ok((name.to_string(), format!("#{}", hex.to_ascii_uppercase())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_colors_are_stored_as_full_rgb_hex() {
        for (input, expected) in [
            (" #aBc ", "#AABBCC"),
            ("a855f7", "#A855F7"),
            ("#000000", "#000000"),
            ("#FFFFFF", "#FFFFFF"),
        ] {
            assert_eq!(
                validated_details(" Client Work ", input).unwrap(),
                ("Client Work".into(), expected.into())
            );
        }
    }

    #[test]
    fn invalid_names_and_color_formats_cannot_reach_storage() {
        assert!(validated_details(" \n ", "#86EFAC").is_err());
        for color in [
            "",
            "red",
            "#12",
            "#ABCDEF00",
            "rgb(1,2,3)",
            "#GGGGGG",
            "##ABC",
            "#😀😀😀",
        ] {
            assert!(validated_details("Client Work", color).is_err(), "{color}");
        }
    }
}
