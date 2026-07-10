// Keygen.sh account configuration. These are identifiers, not secrets: the
// account ID appears in every API URL and the Ed25519 verify key can only
// check signatures, never create them. Licensing auto-disables when they are
// left empty, so forks and contributors always get a working, ungated build.
//
// Fill these in from the Keygen dashboard (Settings page): the account ID and
// the hex-encoded Ed25519 verify key.
pub const KEYGEN_API_URL: &str = "https://api.keygen.sh";
pub const KEYGEN_ACCOUNT_ID: &str = "09191a95-7ae5-4152-ba46-6a8ce47a505d";
pub const KEYGEN_VERIFY_KEY_HEX: &str = "d26d5fbac4be5ba25e9eb1217e824686b77edc75da658e2e5325f5de2c4aa0e3";

/// Maximum TTL requested for machine-file checkouts (90 days); the actual
/// request is capped at the license's remaining lifetime (see checkout_ttl in
/// mod.rs). The app works fully offline until the checked-out file expires.
pub const CHECKOUT_TTL_SECS: i64 = 90 * 24 * 60 * 60;

/// Re-checkout the machine file in the background once it is this old, so
/// online users never approach the TTL cliff.
pub const REFRESH_AFTER_DAYS: i64 = 7;

/// Key of the Keygen package (Dashboard → Packages) with engine "tauri" that
/// serves app updates. Empty disables update checks entirely.
pub const KEYGEN_PACKAGE: &str = "cmmc";

/// Linux is notify-only (no AppImage, so no in-place updates); point users at
/// the download page instead.
pub const UPDATE_DOWNLOAD_URL: &str = "https://getcmmc.consulting/";

/// Licensing is compiled in but inert until the account constants are set.
pub fn enabled() -> bool {
    !KEYGEN_ACCOUNT_ID.is_empty() && !KEYGEN_VERIFY_KEY_HEX.is_empty()
}

/// Update checks ride on licensing (the license key authenticates against the
/// Keygen distribution engine), so both must be configured.
pub fn updates_enabled() -> bool {
    enabled() && !KEYGEN_PACKAGE.is_empty()
}
