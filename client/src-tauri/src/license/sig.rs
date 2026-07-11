// Verification of Keygen's signed API responses
// (https://keygen.sh/docs/api/signatures/). Every trusted response carries a
// `Keygen-Signature` header: an Ed25519 signature over a signing string built
// from `(request-target) host date digest`, which binds the response body (via
// the Digest header) to the endpoint, host, and time it was served. Verifying
// it means a spoofed api.keygen.sh cannot alter — or replay — the API
// responses that activation trusts; together with the independently signed
// machine file this closes the activation path end to end. Pure functions
// only — no IO — so the whole trust path is unit-testable.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use ed25519_dalek::{Signature, VerifyingKey};
use sha2::{Digest as _, Sha256};
use time::macros::format_description;
use time::{Duration, OffsetDateTime, PrimitiveDateTime};

const SUPPORTED_ALG: &str = "ed25519";

/// Maximum age (or future skew) of the response's Date header. Keygen's docs
/// recommend rejecting responses older than 5 minutes to block replays; this
/// is the app's strictest clock requirement, and only applies while online —
/// a badly wrong system clock surfaces as an activation error, not a lockout.
const DATE_TOLERANCE: Duration = Duration::minutes(5);

/// The bindings a signature must cover to be worth anything: the `headers`
/// parameter drives the signing string but is not itself signed, so a
/// stripped-down list must not be able to dodge the body digest or the
/// replay window.
const REQUIRED_COMPONENTS: [&str; 3] = ["(request-target)", "digest", "date"];

#[derive(Debug, PartialEq)]
pub enum SigError {
    /// No Keygen-Signature header at all.
    MissingSignature,
    Malformed(String),
    UnsupportedAlgorithm(String),
    /// The Digest header does not match the body we received.
    DigestMismatch,
    BadSignature,
    /// Authentic, but outside the replay window (or the local clock is off).
    StaleDate,
}

impl std::fmt::Display for SigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SigError::MissingSignature => write!(f, "response carried no Keygen signature"),
            SigError::Malformed(detail) => write!(f, "malformed response signature: {detail}"),
            SigError::UnsupportedAlgorithm(alg) => {
                write!(f, "unsupported response signature algorithm: {alg}")
            }
            SigError::DigestMismatch => {
                write!(f, "response body does not match its signed digest")
            }
            SigError::BadSignature => write!(f, "response signature is invalid"),
            SigError::StaleDate => write!(
                f,
                "response date is outside the accepted window — check that the system clock is correct"
            ),
        }
    }
}

/// The pieces of an HTTP response that participate in signature verification.
pub struct ResponseParts<'a> {
    /// Request method, any case (lowercased for the signing string).
    pub method: &'a str,
    /// Request path including the query string, e.g. `/v1/accounts/x/machines`.
    pub target: &'a str,
    /// Host the request was sent to, e.g. `api.keygen.sh`.
    pub host: &'a str,
    /// The response's `Date` header.
    pub date: Option<&'a str>,
    /// The response's `Digest` header (`sha-256=<base64>`).
    pub digest: Option<&'a str>,
    /// The response's `Keygen-Signature` header.
    pub signature: Option<&'a str>,
    /// Raw response body, exactly as received.
    pub body: &'a [u8],
}

struct SignatureParams {
    algorithm: String,
    signature: String,
    /// Space-separated component list, e.g. `(request-target) host date digest`.
    headers: String,
}

/// Verify that a response was signed by the account's Ed25519 key, that its
/// body matches the signed digest, and that it is fresh enough not to be a
/// replay.
pub fn verify_response(
    parts: &ResponseParts,
    verify_key_hex: &str,
    now: OffsetDateTime,
) -> Result<(), SigError> {
    let header = parts.signature.ok_or(SigError::MissingSignature)?;
    let params = parse_signature_header(header)?;

    if params.algorithm != SUPPORTED_ALG {
        return Err(SigError::UnsupportedAlgorithm(params.algorithm));
    }
    for required in REQUIRED_COMPONENTS {
        if !params.headers.split_whitespace().any(|name| name == required) {
            return Err(SigError::Malformed(format!(
                "signature does not cover {required}"
            )));
        }
    }

    // Hash the raw bytes as received — before any JSON parsing — so the
    // signature covers exactly what we are about to trust.
    let digest = parts
        .digest
        .ok_or_else(|| SigError::Malformed("missing digest header".into()))?;
    let expected = format!("sha-256={}", BASE64.encode(Sha256::digest(parts.body)));
    if digest != expected {
        return Err(SigError::DigestMismatch);
    }

    let message = signing_data(parts, &params.headers)?;

    let key_bytes: [u8; 32] = hex::decode(verify_key_hex)
        .map_err(|err| SigError::Malformed(format!("verify key: {err}")))?
        .try_into()
        .map_err(|_| SigError::Malformed("verify key: wrong length".into()))?;
    let verify_key = VerifyingKey::from_bytes(&key_bytes)
        .map_err(|err| SigError::Malformed(format!("verify key: {err}")))?;

    let sig_bytes = BASE64
        .decode(&params.signature)
        .map_err(|err| SigError::Malformed(format!("signature: {err}")))?;
    let signature = Signature::from_slice(&sig_bytes)
        .map_err(|err| SigError::Malformed(format!("signature: {err}")))?;

    verify_key
        .verify_strict(message.as_bytes(), &signature)
        .map_err(|_| SigError::BadSignature)?;

    // Freshness last, so clock problems are only reported for authentic
    // responses.
    let date = parse_http_date(parts.date.unwrap_or_default())?;
    if (now - date).abs() > DATE_TOLERANCE {
        return Err(SigError::StaleDate);
    }

    Ok(())
}

// `keyid="...", algorithm="ed25519", signature="...", headers="..."` — no
// value contains a comma or quote (ids, algorithm names, base64, header
// names), so splitting on commas is safe.
fn parse_signature_header(header: &str) -> Result<SignatureParams, SigError> {
    let mut algorithm = None;
    let mut signature = None;
    let mut headers = None;

    for pair in header.split(',') {
        let Some((key, value)) = pair.trim().split_once('=') else {
            continue;
        };
        let value = value.trim_matches('"').to_string();
        match key.trim() {
            "algorithm" => algorithm = Some(value),
            "signature" => signature = Some(value),
            "headers" => headers = Some(value),
            _ => {}
        }
    }

    Ok(SignatureParams {
        algorithm: algorithm
            .ok_or_else(|| SigError::Malformed("signature header has no algorithm".into()))?,
        signature: signature
            .ok_or_else(|| SigError::Malformed("signature header has no signature".into()))?,
        headers: headers
            .ok_or_else(|| SigError::Malformed("signature header has no headers list".into()))?,
    })
}

// Rebuild the signing string exactly as Keygen constructed it: one line per
// component in the order given by the `headers` parameter, joined by `\n`
// with no trailing newline.
fn signing_data(parts: &ResponseParts, components: &str) -> Result<String, SigError> {
    let missing =
        |name: &str| SigError::Malformed(format!("signed {name} header is missing"));

    components
        .split_whitespace()
        .map(|name| match name {
            "(request-target)" => Ok(format!(
                "(request-target): {} {}",
                parts.method.to_ascii_lowercase(),
                parts.target
            )),
            "host" => Ok(format!("host: {}", parts.host)),
            "date" => Ok(format!("date: {}", parts.date.ok_or_else(|| missing("date"))?)),
            "digest" => Ok(format!(
                "digest: {}",
                parts.digest.ok_or_else(|| missing("digest"))?
            )),
            other => Err(SigError::Malformed(format!(
                "signature covers an unsupported header: {other}"
            ))),
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|lines| lines.join("\n"))
}

// HTTP dates are IMF-fixdate: `Wed, 09 Jun 2021 16:08:15 GMT`. The weekday
// prefix is redundant, so it is stripped rather than validated.
fn parse_http_date(raw: &str) -> Result<OffsetDateTime, SigError> {
    let format =
        format_description!("[day] [month repr:short] [year] [hour]:[minute]:[second] GMT");
    let rest = raw.split_once(", ").map_or(raw, |(_, rest)| rest);
    PrimitiveDateTime::parse(rest.trim(), format)
        .map(PrimitiveDateTime::assume_utc)
        .map_err(|err| SigError::Malformed(format!("date header: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use time::macros::datetime;

    const NOW: OffsetDateTime = datetime!(2026-07-01 12:00 UTC);
    const DATE: &str = "Wed, 01 Jul 2026 12:00:00 GMT";
    const METHOD: &str = "POST";
    const TARGET: &str = "/v1/accounts/acct/machines/m1/actions/check-out?ttl=3600";
    const HOST: &str = "api.keygen.sh";
    const BODY: &[u8] = br#"{"data":{"id":"m1"}}"#;

    fn signing_key() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    fn verify_key_hex() -> String {
        hex::encode(signing_key().verifying_key().to_bytes())
    }

    fn digest_for(body: &[u8]) -> String {
        format!("sha-256={}", BASE64.encode(Sha256::digest(body)))
    }

    fn signature_header(components: &str, date: &str, digest: &str) -> String {
        let message = ResponseParts {
            method: METHOD,
            target: TARGET,
            host: HOST,
            date: Some(date),
            digest: Some(digest),
            signature: None,
            body: BODY,
        };
        let signing_data = signing_data(&message, components).unwrap();
        let sig = BASE64.encode(signing_key().sign(signing_data.as_bytes()).to_bytes());
        format!(
            r#"keyid="acct", algorithm="ed25519", signature="{sig}", headers="{components}""#
        )
    }

    fn parts<'a>(
        date: &'a str,
        digest: &'a str,
        signature: &'a str,
        body: &'a [u8],
    ) -> ResponseParts<'a> {
        ResponseParts {
            method: METHOD,
            target: TARGET,
            host: HOST,
            date: Some(date),
            digest: Some(digest),
            signature: Some(signature),
            body,
        }
    }

    const COMPONENTS: &str = "(request-target) host date digest";

    #[test]
    fn verifies_a_signed_response() {
        let digest = digest_for(BODY);
        let header = signature_header(COMPONENTS, DATE, &digest);
        assert_eq!(
            verify_response(&parts(DATE, &digest, &header, BODY), &verify_key_hex(), NOW),
            Ok(())
        );
    }

    #[test]
    fn binds_the_query_string_into_the_signature() {
        let digest = digest_for(BODY);
        let header = signature_header(COMPONENTS, DATE, &digest);
        let mut altered = parts(DATE, &digest, &header, BODY);
        // Same path, different query: the checkout TTL must not be malleable.
        altered.target = "/v1/accounts/acct/machines/m1/actions/check-out?ttl=1";
        assert_eq!(
            verify_response(&altered, &verify_key_hex(), NOW),
            Err(SigError::BadSignature)
        );
    }

    #[test]
    fn rejects_a_tampered_body() {
        let digest = digest_for(BODY);
        let header = signature_header(COMPONENTS, DATE, &digest);
        assert_eq!(
            verify_response(
                &parts(DATE, &digest, &header, br#"{"data":{"id":"evil"}}"#),
                &verify_key_hex(),
                NOW
            ),
            Err(SigError::DigestMismatch)
        );
    }

    #[test]
    fn rejects_a_recomputed_digest_over_a_tampered_body() {
        // The attacker fixes up the Digest header to match their body; the
        // signature (over the original digest) must still fail.
        let header = signature_header(COMPONENTS, DATE, &digest_for(BODY));
        let evil_body: &[u8] = br#"{"data":{"id":"evil"}}"#;
        let evil_digest = digest_for(evil_body);
        assert_eq!(
            verify_response(
                &parts(DATE, &evil_digest, &header, evil_body),
                &verify_key_hex(),
                NOW
            ),
            Err(SigError::BadSignature)
        );
    }

    #[test]
    fn rejects_the_wrong_key() {
        let digest = digest_for(BODY);
        let header = signature_header(COMPONENTS, DATE, &digest);
        let other_key = hex::encode(
            SigningKey::from_bytes(&[9u8; 32])
                .verifying_key()
                .to_bytes(),
        );
        assert_eq!(
            verify_response(&parts(DATE, &digest, &header, BODY), &other_key, NOW),
            Err(SigError::BadSignature)
        );
    }

    #[test]
    fn rejects_a_missing_signature_header() {
        let digest = digest_for(BODY);
        let mut unsigned = parts(DATE, &digest, "", BODY);
        unsigned.signature = None;
        assert_eq!(
            verify_response(&unsigned, &verify_key_hex(), NOW),
            Err(SigError::MissingSignature)
        );
    }

    #[test]
    fn rejects_unsupported_algorithms() {
        let digest = digest_for(BODY);
        let header = signature_header(COMPONENTS, DATE, &digest)
            .replace(r#"algorithm="ed25519""#, r#"algorithm="rsa-sha256""#);
        assert!(matches!(
            verify_response(&parts(DATE, &digest, &header, BODY), &verify_key_hex(), NOW),
            Err(SigError::UnsupportedAlgorithm(_))
        ));
    }

    #[test]
    fn rejects_a_signature_that_omits_the_digest() {
        // Even signed with the real key, a component list that skips the
        // digest binds nothing about the body — refuse it outright.
        let digest = digest_for(BODY);
        let header = signature_header("(request-target) host date", DATE, &digest);
        assert!(matches!(
            verify_response(&parts(DATE, &digest, &header, BODY), &verify_key_hex(), NOW),
            Err(SigError::Malformed(_))
        ));
    }

    #[test]
    fn rejects_a_replayed_response() {
        let stale = "Wed, 01 Jul 2026 11:54:00 GMT"; // 6 minutes before NOW
        let digest = digest_for(BODY);
        let header = signature_header(COMPONENTS, stale, &digest);
        assert_eq!(
            verify_response(&parts(stale, &digest, &header, BODY), &verify_key_hex(), NOW),
            Err(SigError::StaleDate)
        );
    }

    #[test]
    fn rejects_a_future_dated_response() {
        let future = "Wed, 01 Jul 2026 12:06:00 GMT"; // 6 minutes after NOW
        let digest = digest_for(BODY);
        let header = signature_header(COMPONENTS, future, &digest);
        assert_eq!(
            verify_response(&parts(future, &digest, &header, BODY), &verify_key_hex(), NOW),
            Err(SigError::StaleDate)
        );
    }

    #[test]
    fn tolerates_clock_skew_inside_the_window() {
        let recent = "Wed, 01 Jul 2026 11:56:00 GMT"; // 4 minutes before NOW
        let digest = digest_for(BODY);
        let header = signature_header(COMPONENTS, recent, &digest);
        assert_eq!(
            verify_response(&parts(recent, &digest, &header, BODY), &verify_key_hex(), NOW),
            Ok(())
        );
    }

    #[test]
    fn parses_http_dates() {
        assert_eq!(
            parse_http_date("Wed, 09 Jun 2021 16:08:15 GMT").unwrap(),
            datetime!(2021-06-09 16:08:15 UTC)
        );
        assert!(matches!(
            parse_http_date("not a date"),
            Err(SigError::Malformed(_))
        ));
    }
}
