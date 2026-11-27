//! Email sign-in: a 6-digit one-time code sent through an email API (Resend).
//!
//! The canister sends the email with a non-replicated HTTPS outcall (one node
//! makes the request, so the user gets one email). Only a hash of the email
//! address and of the code is kept; the address is needed in clear only to send.

use candid::{CandidType, Deserialize, Principal};
use ic_management_canister_types::{HttpHeader, HttpMethod, HttpRequestArgs, HttpRequestResult};

pub const CODE_TTL_NS: u64 = 10 * 60 * 1_000_000_000;
pub const MAX_ATTEMPTS: u8 = 5;
pub const PER_EMAIL_WINDOW_NS: u64 = 15 * 60 * 1_000_000_000;
pub const PER_EMAIL_MAX: usize = 3;
const OUTCALL_CYCLES: u128 = 20_000_000_000;

#[derive(CandidType, Deserialize)]
pub struct EmailChallenge {
    pub challenge_id: String,
    pub sent_to: String,
    pub expires_at_ns: u64,
}

#[derive(CandidType, Deserialize)]
pub struct EmailSenderInput {
    pub api_key: String,
    pub from: String,
    pub daily_limit: Option<u32>,
}

#[derive(CandidType, Deserialize)]
pub struct EmailStatus {
    pub configured: bool,
    pub from: Option<String>,
    pub sent_today: u32,
    pub daily_limit: u32,
}

/// Lower-cases and validates an email address (pragmatic check, not full RFC 5322).
pub fn normalize_email(input: &str) -> Result<String, String> {
    let e = input.trim().to_lowercase();
    let ok = e.len() <= 254
        && !e.chars().any(|c| c.is_whitespace() || c.is_control() || c == '<' || c == '>' || c == '"' || c == ',')
        && match e.split_once('@') {
            Some((local, domain)) => {
                !local.is_empty()
                    && local.len() <= 64
                    && domain.contains('.')
                    && !domain.starts_with('.')
                    && !domain.ends_with('.')
                    && !domain.contains('@')
            }
            None => false,
        };
    if ok {
        Ok(e)
    } else {
        Err("Enter a valid email address".into())
    }
}

/// "ada.lovelace@example.com" -> "a**********e@example.com"
pub fn mask_email(email: &str) -> String {
    let (local, domain) = email.split_once('@').unwrap_or((email, ""));
    let chars: Vec<char> = local.chars().collect();
    let masked = match chars.len() {
        0 => String::new(),
        1 | 2 => format!("{}*", chars[0]),
        n => format!("{}{}{}", chars[0], "*".repeat(n - 2), chars[n - 1]),
    };
    format!("{masked}@{domain}")
}

/// Six digits from random bytes, without modulo bias worth caring about (2^32 vs 10^6).
pub fn code_from(bytes: &[u8]) -> String {
    let n = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) % 1_000_000;
    format!("{n:06}")
}

pub fn email_body(code: &str, origin: &str) -> (String, String) {
    let text = format!(
        "Your OpenSocial sign-in code is {code}\n\nIt expires in 10 minutes. Enter it on the page where you asked for it ({origin}).\n\nIf you didn't try to sign in to OpenSocial, ignore this email. Nobody can sign in without this code."
    );
    let html = format!(
        "<div style=\"font-family:Inter,Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#1a1714\">\
<p style=\"font-size:15px\">Your OpenSocial sign-in code is</p>\
<p style=\"font-size:32px;font-weight:700;letter-spacing:6px;margin:8px 0 16px\">{code}</p>\
<p style=\"font-size:14px;color:#6f6961\">It expires in 10 minutes. Enter it on the page where you asked for it ({origin}).</p>\
<p style=\"font-size:13px;color:#6f6961\">If you didn't try to sign in to OpenSocial, ignore this email. Nobody can sign in without this code.</p></div>"
    );
    (text, html)
}

pub async fn send_with_resend(
    api_key: &str,
    from: &str,
    to: &str,
    idempotency_key: &str,
    code: &str,
    origin: &str,
) -> Result<(), String> {
    let (text, html) = email_body(code, origin);
    let body = serde_json::json!({
        "from": from,
        "to": [to],
        "subject": format!("{code} is your OpenSocial sign-in code"),
        "text": text,
        "html": html,
    });
    let args = HttpRequestArgs {
        url: "https://api.resend.com/emails".into(),
        max_response_bytes: Some(4_096),
        method: HttpMethod::POST,
        headers: vec![
            HttpHeader { name: "Authorization".into(), value: format!("Bearer {api_key}") },
            HttpHeader { name: "Content-Type".into(), value: "application/json".into() },
            HttpHeader { name: "Idempotency-Key".into(), value: idempotency_key.into() },
            HttpHeader { name: "User-Agent".into(), value: "open-social-identity".into() },
        ],
        body: Some(body.to_string().into_bytes()),
        transform: None,
        is_replicated: Some(false),
        pricing_version: Some(2),
    };
    let res = ic_cdk::call::Call::unbounded_wait(Principal::management_canister(), "http_request")
        .with_arg(args)
        .with_cycles(OUTCALL_CYCLES)
        .await
        .map_err(|e| format!("Email service unreachable: {e:?}"))?;
    let result: HttpRequestResult = res.candid().map_err(|e| format!("Bad outcall response: {e:?}"))?;
    let status: u64 = result.status.0.try_into().unwrap_or(0);
    if (200..300).contains(&status) {
        Ok(())
    } else {
        let snippet: String = String::from_utf8_lossy(&result.body).chars().take(200).collect();
        Err(format!("Email service returned {status}: {snippet}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_and_validates() {
        assert_eq!(normalize_email("  Ada.Lovelace@Example.com ").unwrap(), "ada.lovelace@example.com");
        for bad in ["", "a", "a@b", "@b.com", "a@.com", "a@b.com.", "a b@c.com", "a@b@c.com", "x\n@y.com", "<a@b.com>"] {
            assert!(normalize_email(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn masks_addresses() {
        assert_eq!(mask_email("ada.lovelace@example.com"), "a**********e@example.com");
        assert_eq!(mask_email("ab@x.io"), "a*@x.io");
        assert_eq!(mask_email("a@x.io"), "a*@x.io");
    }

    #[test]
    fn codes_are_six_digits() {
        assert_eq!(code_from(&[0, 0, 0, 7]), "000007");
        assert_eq!(code_from(&[255, 255, 255, 255]).len(), 6);
    }

    #[test]
    fn body_contains_code_and_origin() {
        let (text, html) = email_body("123456", "https://example.icp0.io");
        assert!(text.contains("123456") && text.contains("https://example.icp0.io"));
        assert!(html.contains("123456"));
    }
}
