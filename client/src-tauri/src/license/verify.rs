// Offline verification of Keygen machine files. A machine file is a PEM-like
// certificate whose base64 body decodes to `{ enc, sig, alg }`: `enc` is the
// still-base64 JSON:API document describing the machine + license, and `sig`
// is an Ed25519 signature over the ASCII bytes of `"machine/{enc}"`. Pure
// functions only — no IO — so the whole trust path is unit-testable.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::Deserialize;
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};

const HEADER: &str = "-----BEGIN MACHINE FILE-----";
const FOOTER: &str = "-----END MACHINE FILE-----";
const SIGNING_PREFIX: &str = "machine/";
const SUPPORTED_ALG: &str = "base64+ed25519";

/// Clock-skew allowance when comparing the file's `issued` timestamp against
/// local time; anything issued further in the future means the local clock has
/// been rolled back past the point where the file can be trusted.
const ISSUED_TOLERANCE: Duration = Duration::hours(24);

#[derive(Debug, PartialEq)]
pub enum VerifyError {
    Malformed(String),
    UnsupportedAlgorithm(String),
    BadSignature,
}

impl std::fmt::Display for VerifyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VerifyError::Malformed(detail) => write!(f, "malformed machine file: {detail}"),
            VerifyError::UnsupportedAlgorithm(alg) => {
                write!(f, "unsupported machine file algorithm: {alg}")
            }
            VerifyError::BadSignature => write!(f, "machine file signature is invalid"),
        }
    }
}

/// The verified, decoded contents of a machine file.
#[derive(Debug, PartialEq)]
pub struct MachineFile {
    pub fingerprint: String,
    pub issued: OffsetDateTime,
    /// When the checked-out file itself lapses (`meta.expiry`).
    pub expiry: OffsetDateTime,
    /// The underlying license's expiry, when the policy sets one.
    pub license_expiry: Option<OffsetDateTime>,
    /// Keygen trial licenses are ordinary licenses flagged by convention with
    /// `metadata: { "trial": true }` (set on the license or inherited from a
    /// trial policy's default metadata). See docs/licensing.md.
    pub license_is_trial: bool,
}

#[derive(Debug, PartialEq)]
pub enum CheckResult {
    Valid,
    /// Signature is fine but the file (or clock) is outside its validity
    /// window — a fresh checkout over the network fixes it.
    Stale,
    LicenseExpired,
    WrongMachine,
}

#[derive(Deserialize)]
struct Envelope {
    enc: String,
    sig: String,
    alg: String,
}

#[derive(Deserialize)]
struct Document {
    data: DocumentData,
    #[serde(default)]
    included: Vec<Included>,
    meta: DocumentMeta,
}

#[derive(Deserialize)]
struct DocumentData {
    attributes: MachineAttributes,
}

#[derive(Deserialize)]
struct MachineAttributes {
    fingerprint: String,
}

#[derive(Deserialize)]
struct Included {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    attributes: serde_json::Value,
}

#[derive(Deserialize)]
struct DocumentMeta {
    issued: String,
    expiry: String,
}

/// Parse a certificate, verify its Ed25519 signature against the account's
/// verify key (hex), and decode the signed payload.
pub fn parse_and_verify(certificate: &str, verify_key_hex: &str) -> Result<MachineFile, VerifyError> {
    let body: String = certificate
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && *line != HEADER && *line != FOOTER)
        .collect();

    let envelope = BASE64
        .decode(body)
        .map_err(|err| VerifyError::Malformed(format!("certificate body: {err}")))?;
    let envelope: Envelope = serde_json::from_slice(&envelope)
        .map_err(|err| VerifyError::Malformed(format!("certificate envelope: {err}")))?;

    if envelope.alg != SUPPORTED_ALG {
        return Err(VerifyError::UnsupportedAlgorithm(envelope.alg));
    }

    let key_bytes: [u8; 32] = hex::decode(verify_key_hex)
        .map_err(|err| VerifyError::Malformed(format!("verify key: {err}")))?
        .try_into()
        .map_err(|_| VerifyError::Malformed("verify key: wrong length".into()))?;
    let verify_key = VerifyingKey::from_bytes(&key_bytes)
        .map_err(|err| VerifyError::Malformed(format!("verify key: {err}")))?;

    let sig_bytes = BASE64
        .decode(&envelope.sig)
        .map_err(|err| VerifyError::Malformed(format!("signature: {err}")))?;
    let signature = Signature::from_slice(&sig_bytes)
        .map_err(|err| VerifyError::Malformed(format!("signature: {err}")))?;

    // The signed message is the literal prefix plus the *still-encoded*
    // payload, so verify before decoding `enc`.
    let message = format!("{SIGNING_PREFIX}{}", envelope.enc);
    verify_key
        .verify_strict(message.as_bytes(), &signature)
        .map_err(|_| VerifyError::BadSignature)?;

    let payload = BASE64
        .decode(&envelope.enc)
        .map_err(|err| VerifyError::Malformed(format!("payload: {err}")))?;
    let document: Document = serde_json::from_slice(&payload)
        .map_err(|err| VerifyError::Malformed(format!("payload document: {err}")))?;

    let issued = parse_timestamp(&document.meta.issued, "meta.issued")?;
    let expiry = parse_timestamp(&document.meta.expiry, "meta.expiry")?;

    let license = document
        .included
        .iter()
        .find(|item| item.kind == "licenses")
        .map(|license| &license.attributes);

    let license_expiry = license
        .and_then(|attributes| attributes.get("expiry"))
        .and_then(|expiry| expiry.as_str())
        .map(|expiry| parse_timestamp(expiry, "license expiry"))
        .transpose()?;

    let license_is_trial = license
        .and_then(|attributes| attributes.get("metadata"))
        .and_then(|metadata| metadata.get("trial"))
        .and_then(|trial| trial.as_bool())
        .unwrap_or(false);

    Ok(MachineFile {
        fingerprint: document.data.attributes.fingerprint,
        issued,
        expiry,
        license_expiry,
        license_is_trial,
    })
}

/// Judge a verified machine file against the current device and clock.
pub fn check(file: &MachineFile, fingerprint: &str, now: OffsetDateTime) -> CheckResult {
    if file.fingerprint != fingerprint {
        return CheckResult::WrongMachine;
    }
    if file.issued > now + ISSUED_TOLERANCE || file.expiry <= now {
        return CheckResult::Stale;
    }
    if file.license_expiry.is_some_and(|expiry| expiry <= now) {
        return CheckResult::LicenseExpired;
    }
    CheckResult::Valid
}

fn parse_timestamp(raw: &str, what: &str) -> Result<OffsetDateTime, VerifyError> {
    OffsetDateTime::parse(raw, &Rfc3339)
        .map_err(|err| VerifyError::Malformed(format!("{what}: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use time::macros::datetime;

    const NOW: OffsetDateTime = datetime!(2026-07-01 12:00 UTC);
    const FINGERPRINT: &str = "abc123";

    fn signing_key() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    fn verify_key_hex() -> String {
        hex::encode(signing_key().verifying_key().to_bytes())
    }

    fn document_json(license_expiry: Option<&str>) -> String {
        document_json_with(license_expiry, "{}")
    }

    fn document_json_with(license_expiry: Option<&str>, metadata: &str) -> String {
        let license_expiry =
            license_expiry.map_or("null".to_string(), |expiry| format!("\"{expiry}\""));
        format!(
            r#"{{
                "data": {{
                    "type": "machines",
                    "id": "machine-1",
                    "attributes": {{ "fingerprint": "{FINGERPRINT}" }}
                }},
                "included": [
                    {{
                        "type": "licenses",
                        "id": "license-1",
                        "attributes": {{
                            "key": "KEY-1",
                            "expiry": {license_expiry},
                            "metadata": {metadata}
                        }}
                    }}
                ],
                "meta": {{
                    "issued": "2026-07-01T00:00:00Z",
                    "expiry": "2026-09-29T00:00:00Z",
                    "ttl": 7776000
                }}
            }}"#
        )
    }

    fn certificate(document: &str) -> String {
        let enc = BASE64.encode(document);
        let sig = BASE64.encode(
            signing_key()
                .sign(format!("{SIGNING_PREFIX}{enc}").as_bytes())
                .to_bytes(),
        );
        let envelope = serde_json::json!({ "enc": enc, "sig": sig, "alg": SUPPORTED_ALG });
        let body = BASE64.encode(envelope.to_string());
        format!("{HEADER}\n{body}\n{FOOTER}\n")
    }

    #[test]
    fn verifies_and_decodes_a_valid_certificate() {
        let cert = certificate(&document_json(None));
        let file = parse_and_verify(&cert, &verify_key_hex()).unwrap();

        assert_eq!(file.fingerprint, FINGERPRINT);
        assert_eq!(file.issued, datetime!(2026-07-01 00:00 UTC));
        assert_eq!(file.expiry, datetime!(2026-09-29 00:00 UTC));
        assert_eq!(file.license_expiry, None);
        assert!(!file.license_is_trial);
        assert_eq!(check(&file, FINGERPRINT, NOW), CheckResult::Valid);
    }

    #[test]
    fn detects_a_trial_license() {
        let cert = certificate(&document_json_with(
            Some("2026-07-15T00:00:00Z"),
            r#"{ "trial": true }"#,
        ));
        let file = parse_and_verify(&cert, &verify_key_hex()).unwrap();

        assert!(file.license_is_trial);
        assert_eq!(check(&file, FINGERPRINT, NOW), CheckResult::Valid);

        // A lapsed trial license reads as expired like any other license.
        let after = datetime!(2026-07-16 00:00 UTC);
        assert_eq!(check(&file, FINGERPRINT, after), CheckResult::LicenseExpired);
    }

    #[test]
    fn rejects_a_tampered_payload() {
        let cert = certificate(&document_json(None));
        // Re-encode with a different fingerprint but keep the original
        // signature: the envelope decodes fine, the signature must not.
        let tampered_doc = document_json(None).replace(FINGERPRINT, "evil");
        let original_enc = BASE64.encode(document_json(None));
        let tampered_enc = BASE64.encode(&tampered_doc);
        let body: String = cert
            .lines()
            .filter(|line| !line.starts_with("-----"))
            .collect();
        let swapped = String::from_utf8(BASE64.decode(body).unwrap())
            .unwrap()
            .replace(&original_enc, &tampered_enc);
        let cert = format!("{HEADER}\n{}\n{FOOTER}\n", BASE64.encode(swapped));

        assert_eq!(
            parse_and_verify(&cert, &verify_key_hex()),
            Err(VerifyError::BadSignature)
        );
    }

    #[test]
    fn rejects_the_wrong_verify_key() {
        let cert = certificate(&document_json(None));
        let other_key = hex::encode(
            SigningKey::from_bytes(&[9u8; 32])
                .verifying_key()
                .to_bytes(),
        );
        assert_eq!(
            parse_and_verify(&cert, &other_key),
            Err(VerifyError::BadSignature)
        );
    }

    #[test]
    fn rejects_unsupported_algorithms() {
        let doc = document_json(None);
        let enc = BASE64.encode(&doc);
        let sig = BASE64.encode(
            signing_key()
                .sign(format!("{SIGNING_PREFIX}{enc}").as_bytes())
                .to_bytes(),
        );
        let envelope =
            serde_json::json!({ "enc": enc, "sig": sig, "alg": "aes-256-gcm+ed25519" });
        let cert = format!("{HEADER}\n{}\n{FOOTER}\n", BASE64.encode(envelope.to_string()));

        assert!(matches!(
            parse_and_verify(&cert, &verify_key_hex()),
            Err(VerifyError::UnsupportedAlgorithm(_))
        ));
    }

    #[test]
    fn flags_the_wrong_machine() {
        let cert = certificate(&document_json(None));
        let file = parse_and_verify(&cert, &verify_key_hex()).unwrap();
        assert_eq!(check(&file, "different", NOW), CheckResult::WrongMachine);
    }

    #[test]
    fn flags_an_expired_machine_file_as_stale() {
        let cert = certificate(&document_json(None));
        let file = parse_and_verify(&cert, &verify_key_hex()).unwrap();
        let after_expiry = datetime!(2026-10-01 00:00 UTC);
        assert_eq!(check(&file, FINGERPRINT, after_expiry), CheckResult::Stale);
    }

    #[test]
    fn flags_a_rolled_back_clock_as_stale() {
        let cert = certificate(&document_json(None));
        let file = parse_and_verify(&cert, &verify_key_hex()).unwrap();
        let before_issue = datetime!(2026-06-29 00:00 UTC);
        assert_eq!(check(&file, FINGERPRINT, before_issue), CheckResult::Stale);
    }

    #[test]
    fn flags_an_expired_license() {
        let cert = certificate(&document_json(Some("2026-06-30T00:00:00Z")));
        let file = parse_and_verify(&cert, &verify_key_hex()).unwrap();
        assert_eq!(
            check(&file, FINGERPRINT, NOW),
            CheckResult::LicenseExpired
        );
    }
}
