// Thin client for the Keygen.sh JSON:API endpoints used by activation. All
// requests authenticate with the license key itself (the policy must use the
// LICENSE or MIXED authentication strategy), so no account tokens ever ship
// with the app. Every response body is verified against the account's
// Keygen-Signature header before being parsed (see sig.rs).

use super::{config, sig};
use serde_json::{json, Value};
use time::OffsetDateTime;

const JSONAPI: &str = "application/vnd.api+json";

#[derive(Debug)]
pub enum ApiError {
    /// Could not reach api.keygen.sh at all.
    Network(String),
    /// Keygen answered with an error code (e.g. MACHINE_LIMIT_EXCEEDED).
    Api { code: String, message: String },
    /// The response failed Keygen-Signature verification — it did not
    /// provably come (unaltered and fresh) from Keygen.
    Signature(String),
}

pub struct Validation {
    /// Keygen validation code, e.g. VALID / NO_MACHINE / EXPIRED. The caller
    /// branches on this rather than the boolean `meta.valid`, because several
    /// non-VALID codes (not-yet-activated) are expected during activation.
    pub code: String,
    pub license_id: Option<String>,
    /// The license's expiry (RFC3339), used to cap the checkout TTL.
    pub expiry: Option<String>,
}

fn url(path: &str) -> String {
    format!(
        "{}/v1/accounts/{}{path}",
        config::KEYGEN_API_URL,
        config::KEYGEN_ACCOUNT_ID
    )
}

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

fn header_string(response: &reqwest::Response, name: &str) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

// Verify the response's Keygen-Signature over the raw bytes, then parse them
// as JSON. Success bodies must verify — they are what activation trusts.
// Keygen does not sign certain error payloads (malformed requests, internal
// errors), so a *missing* signature is tolerated on error statuses, where the
// body only yields an error code and message; a present-but-invalid one is
// still fatal.
async fn verified_json_body(
    method: &str,
    response: reqwest::Response,
) -> Result<(reqwest::StatusCode, Value), ApiError> {
    let status = response.status();
    let url = response.url().clone();
    let date = header_string(&response, "date");
    let digest = header_string(&response, "digest");
    let signature = header_string(&response, "keygen-signature");
    let bytes = response
        .bytes()
        .await
        .map_err(|err| ApiError::Network(err.to_string()))?;

    let target = match url.query() {
        Some(query) => format!("{}?{query}", url.path()),
        None => url.path().to_string(),
    };
    let parts = sig::ResponseParts {
        method,
        target: &target,
        host: url.host_str().unwrap_or_default(),
        date: date.as_deref(),
        digest: digest.as_deref(),
        signature: signature.as_deref(),
        body: &bytes,
    };
    match sig::verify_response(&parts, config::KEYGEN_VERIFY_KEY_HEX, OffsetDateTime::now_utc()) {
        Ok(()) => {}
        Err(sig::SigError::MissingSignature) if !status.is_success() => {}
        Err(err) => return Err(ApiError::Signature(err.to_string())),
    }

    let body = serde_json::from_slice(&bytes)
        .map_err(|err| ApiError::Network(format!("unexpected response body: {err}")))?;
    Ok((status, body))
}

// Keygen errors arrive as `{ "errors": [{ "code", "title", "detail" }] }`.
fn api_error(body: &Value) -> ApiError {
    let first = body.get("errors").and_then(|errors| errors.get(0));
    let code = first
        .and_then(|error| error.get("code"))
        .and_then(Value::as_str)
        .unwrap_or("API_ERROR")
        .to_string();
    let message = first
        .and_then(|error| error.get("detail"))
        .and_then(Value::as_str)
        .unwrap_or("unexpected Keygen API error")
        .to_string();
    ApiError::Api { code, message }
}

/// POST /licenses/actions/validate-key, scoped to this machine's fingerprint.
pub async fn validate_key(key: &str, fingerprint: &str) -> Result<Validation, ApiError> {
    let response = client()
        .post(url("/licenses/actions/validate-key"))
        .header("Content-Type", JSONAPI)
        .header("Accept", JSONAPI)
        .body(
            json!({
                "meta": { "key": key, "scope": { "fingerprint": fingerprint } }
            })
            .to_string(),
        )
        .send()
        .await
        .map_err(|err| ApiError::Network(err.to_string()))?;

    let (_, body) = verified_json_body("post", response).await?;
    let has_errors = body
        .get("errors")
        .and_then(Value::as_array)
        .map_or(false, |errors| !errors.is_empty());
    if has_errors {
        return Err(api_error(&body));
    }

    Ok(Validation {
        code: body["meta"]["code"].as_str().unwrap_or("").to_string(),
        license_id: body["data"]["id"].as_str().map(str::to_string),
        expiry: body["data"]["attributes"]["expiry"]
            .as_str()
            .map(str::to_string),
    })
}

/// POST /machines — register this device against the license. If the
/// fingerprint is already activated (e.g. after a reinstall), recover its
/// machine id instead of failing.
pub async fn activate_machine(
    key: &str,
    license_id: &str,
    fingerprint: &str,
) -> Result<String, ApiError> {
    // Cosmetic only — names the machine in the Keygen dashboard.
    let hostname = gethostname::gethostname().to_string_lossy().to_string();
    let hostname = if hostname.is_empty() {
        "desktop".to_string()
    } else {
        hostname
    };

    let response = client()
        .post(url("/machines"))
        .header("Authorization", format!("License {key}"))
        .header("Content-Type", JSONAPI)
        .header("Accept", JSONAPI)
        .body(
            json!({
                "data": {
                    "type": "machines",
                    "attributes": {
                        "fingerprint": fingerprint,
                        "platform": std::env::consts::OS,
                        "name": hostname,
                    },
                    "relationships": {
                        "license": {
                            "data": { "type": "licenses", "id": license_id }
                        }
                    }
                }
            })
            .to_string(),
        )
        .send()
        .await
        .map_err(|err| ApiError::Network(err.to_string()))?;

    let (status, body) = verified_json_body("post", response).await?;

    if status.is_success() {
        return body["data"]["id"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| ApiError::Api {
                code: "API_ERROR".into(),
                message: "machine created but no id returned".into(),
            });
    }

    let error = api_error(&body);
    if let ApiError::Api { code, .. } = &error {
        if code == "FINGERPRINT_TAKEN" {
            return machine_id_for_fingerprint(key, fingerprint).await;
        }
    }
    Err(error)
}

// Machine endpoints accept the fingerprint in place of the machine id.
async fn machine_id_for_fingerprint(key: &str, fingerprint: &str) -> Result<String, ApiError> {
    let response = client()
        .get(url(&format!("/machines/{fingerprint}")))
        .header("Authorization", format!("License {key}"))
        .header("Accept", JSONAPI)
        .send()
        .await
        .map_err(|err| ApiError::Network(err.to_string()))?;

    let (status, body) = verified_json_body("get", response).await?;
    if !status.is_success() {
        return Err(api_error(&body));
    }
    body["data"]["id"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| ApiError::Api {
            code: "API_ERROR".into(),
            message: "machine lookup returned no id".into(),
        })
}

/// POST /machines/{id}/actions/check-out — returns the signed certificate that
/// grants offline access until its TTL lapses.
pub async fn checkout_machine(
    key: &str,
    machine_id: &str,
    ttl_secs: i64,
) -> Result<String, ApiError> {
    let response = client()
        .post(url(&format!(
            "/machines/{machine_id}/actions/check-out?ttl={ttl_secs}&include=license,license.entitlements"
        )))
        .header("Authorization", format!("License {key}"))
        .header("Accept", JSONAPI)
        .send()
        .await
        .map_err(|err| ApiError::Network(err.to_string()))?;

    let (status, body) = verified_json_body("post", response).await?;
    if !status.is_success() {
        return Err(api_error(&body));
    }
    body["data"]["attributes"]["certificate"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| ApiError::Api {
            code: "API_ERROR".into(),
            message: "checkout returned no certificate".into(),
        })
}

/// DELETE /machines/{id} — free the seat. A 404 means it is already gone,
/// which is success for our purposes.
pub async fn deactivate_machine(key: &str, machine_id: &str) -> Result<(), ApiError> {
    let response = client()
        .delete(url(&format!("/machines/{machine_id}")))
        .header("Authorization", format!("License {key}"))
        .header("Accept", JSONAPI)
        .send()
        .await
        .map_err(|err| ApiError::Network(err.to_string()))?;

    let status = response.status();
    if status.is_success() || status == reqwest::StatusCode::NOT_FOUND {
        return Ok(());
    }
    let (_, body) = verified_json_body("delete", response).await?;
    Err(api_error(&body))
}
