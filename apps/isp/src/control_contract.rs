//! Versioned Go-to-Rust ISP runtime control contract.
//!
//! Defines serde request/response envelopes used between the Go control plane
//! (apps/control-plane) and Rust ISP server runtimes (apps/isp), plus the
//! validation rules that turn a raw envelope into a typed outcome.
//!
//! Architecture references:
//!   - docs/decisions/0019-isp-rust-go-boundaries.md, section "Go-to-Rust contract"
//!   - docs/roadmap/20-isp-rust-go-architecture-aaa.md, task M19.02
//!
//! Every control operation uses a versioned private contract with authenticated
//! transport, bounded deadline, correlation ID, operation ID, idempotency key,
//! config generation, typed outcome, redacted errors and replay-safe event
//! identity. Outcomes distinguish planned, applied, acknowledged, rejected,
//! timed_out, drifted and rolled_back. Liveness, readiness, management
//! reachability and protocol-level health are separate signals.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Current contract schema version. Receivers reject envelopes whose
/// `schema_version` does not match (unsupported version).
pub const CONTRACT_SCHEMA_VERSION: u16 = 1;

/// Operations relevant to RADIUS/DHCP/DNS service control.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationType {
    /// Push desired service config to the Rust runtime (RADIUS/DHCP/DNS).
    #[default]
    ConfigPush,
    /// Ack/Nack a previously pushed config generation.
    ConfigAck,
    /// Query the health of a Rust service.
    HealthQuery,
    /// Query the status of an in-flight or completed operation.
    OperationStatus,
}

/// Typed outcome of a control operation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationOutcome {
    Planned,
    Applied,
    Acknowledged,
    Rejected,
    TimedOut,
    Drifted,
    RolledBack,
}

/// Separate health signals — none of these is collapsed into a single "ok".
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthSignal {
    Liveness,
    Readiness,
    ManagementReachability,
    ProtocolHealth,
}

/// Typed error code emitted on negative outcomes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    UnsupportedVersion,
    StaleGeneration,
    DuplicateOperation,
    AuthFailure,
    DeadlineExpired,
    InvalidPayload,
    InternalError,
}

/// Reason an envelope was rejected, mapped to a typed error code and outcome.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RejectionReason {
    UnsupportedVersion(u16),
    StaleGeneration { seen: u64, current: u64 },
    DuplicateOperation { operation_id: String },
    AuthFailure,
    DeadlineExpired,
    InvalidPayload { field: String },
    InternalError,
}

impl RejectionReason {
    pub fn error_code(&self) -> ErrorCode {
        match self {
            RejectionReason::UnsupportedVersion(_) => ErrorCode::UnsupportedVersion,
            RejectionReason::StaleGeneration { .. } => ErrorCode::StaleGeneration,
            RejectionReason::DuplicateOperation { .. } => ErrorCode::DuplicateOperation,
            RejectionReason::AuthFailure => ErrorCode::AuthFailure,
            RejectionReason::DeadlineExpired => ErrorCode::DeadlineExpired,
            RejectionReason::InvalidPayload { .. } => ErrorCode::InvalidPayload,
            RejectionReason::InternalError => ErrorCode::InternalError,
        }
    }

    /// Redacted detail safe to return over the transport (no internals/secrets).
    pub fn redacted_detail(&self) -> String {
        match self {
            RejectionReason::UnsupportedVersion(v) => {
                format!("unsupported contract schema version {}", v)
            }
            RejectionReason::StaleGeneration { seen, current } => {
                format!("stale config generation {} (current {})", seen, current)
            }
            RejectionReason::DuplicateOperation { operation_id } => {
                format!("duplicate operation id {}", operation_id)
            }
            RejectionReason::AuthFailure => "authentication failure".to_string(),
            RejectionReason::DeadlineExpired => "operation deadline expired".to_string(),
            RejectionReason::InvalidPayload { field } => {
                format!("invalid payload field: {}", field)
            }
            RejectionReason::InternalError => "internal error".to_string(),
        }
    }
}

impl fmt::Display for RejectionReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RejectionReason::UnsupportedVersion(v) => {
                write!(f, "unsupported contract schema version {}", v)
            }
            RejectionReason::StaleGeneration { seen, current } => write!(
                f,
                "stale config generation {} (current {})",
                seen, current
            ),
            RejectionReason::DuplicateOperation { operation_id } => {
                write!(f, "duplicate operation id {}", operation_id)
            }
            RejectionReason::AuthFailure => write!(f, "authentication failure"),
            RejectionReason::DeadlineExpired => write!(f, "operation deadline expired"),
            RejectionReason::InvalidPayload { field } => {
                write!(f, "invalid payload field: {}", field)
            }
            RejectionReason::InternalError => write!(f, "internal error"),
        }
    }
}

/// Versioned request envelope sent from the Go control plane to a Rust runtime.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ControlRequest {
    /// Contract schema version (validated by the receiver).
    pub schema_version: u16,
    /// Correlation ID tracing this request end-to-end.
    pub correlation_id: String,
    /// Operation ID identifying this control operation (idempotency scope).
    pub operation_id: String,
    /// Idempotency key: replaying the same key must not re-apply the command.
    pub idempotency_key: String,
    /// Config generation this command targets (stale generations are rejected).
    pub config_generation: u64,
    /// Bounded deadline by which the operation must complete (RFC 3339).
    pub deadline: String,
    /// Authenticated transport token (validated by the receiver).
    pub auth_token: Option<String>,
    /// Operation being requested.
    pub operation_type: OperationType,
    /// Operation-specific payload.
    pub payload: serde_json::Value,
}

/// Versioned response envelope returned by a Rust runtime to Go.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ControlResponse {
    /// Echo of the request schema version.
    pub schema_version: u16,
    /// Echo of the request correlation ID.
    pub correlation_id: String,
    /// Echo of the request operation ID.
    pub operation_id: String,
    /// Typed outcome of the operation.
    pub outcome: OperationOutcome,
    /// Typed error code (set only on negative outcomes).
    pub error_code: Option<ErrorCode>,
    /// Redacted error detail (never raw internals or secrets).
    pub error_detail: Option<String>,
    /// Response-specific payload.
    pub payload: serde_json::Value,
}

/// Context under which a request envelope is validated.
pub struct ValidationContext<'a> {
    /// The config generation the runtime currently serves.
    pub current_generation: u64,
    /// Expected authenticated transport token, if any is required.
    pub expected_auth_token: Option<&'a str>,
    /// IDs of operations already applied (for duplicate detection).
    pub applied_operations: &'a [String],
    /// Whether the request deadline has already passed.
    pub deadline_expired: bool,
}

/// Build a rejected response echoing the request's identity fields.
fn rejected_response(req: &ControlRequest, reason: RejectionReason) -> ControlResponse {
    ControlResponse {
        schema_version: req.schema_version,
        correlation_id: req.correlation_id.clone(),
        operation_id: req.operation_id.clone(),
        outcome: OperationOutcome::Rejected,
        error_code: Some(reason.error_code()),
        error_detail: Some(reason.redacted_detail()),
        payload: serde_json::json!({}),
    }
}

/// Validate a request envelope against the runtime contract.
///
/// Returns a `ControlResponse` in all cases: `Ok(response)` for accepted
/// requests (outcome `Planned`) and `Err(response)` for rejected ones, so
/// callers can serialize either branch over the authenticated transport.
pub fn validate_request(
    req: &ControlRequest,
    ctx: &ValidationContext<'_>,
) -> Result<ControlResponse, ControlResponse> {
    // 1. Schema version compatibility.
    if req.schema_version != CONTRACT_SCHEMA_VERSION {
        return Err(rejected_response(
            req,
            RejectionReason::UnsupportedVersion(req.schema_version),
        ));
    }

    // 2. Authenticated transport.
    match (&req.auth_token, ctx.expected_auth_token) {
        (Some(token), Some(expected))
            if constant_time_eq(token.as_bytes(), expected.as_bytes()) => {}
        (None, Some(_)) | (Some(_), None) | (Some(_), Some(_)) => {
            return Err(rejected_response(req, RejectionReason::AuthFailure));
        }
        (None, None) => {}
    }

    // 3. Required identity fields.
    if req.correlation_id.is_empty() {
        return Err(rejected_response(
            req,
            RejectionReason::InvalidPayload {
                field: "correlation_id".into(),
            },
        ));
    }
    if req.operation_id.is_empty() {
        return Err(rejected_response(
            req,
            RejectionReason::InvalidPayload {
                field: "operation_id".into(),
            },
        ));
    }
    if req.idempotency_key.is_empty() {
        return Err(rejected_response(
            req,
            RejectionReason::InvalidPayload {
                field: "idempotency_key".into(),
            },
        ));
    }

    // 4. Stale config generation.
    if req.config_generation < ctx.current_generation {
        return Err(rejected_response(
            req,
            RejectionReason::StaleGeneration {
                seen: req.config_generation,
                current: ctx.current_generation,
            },
        ));
    }

    // 5. Duplicate operation / idempotency key.
    if ctx.applied_operations.contains(&req.operation_id)
        || ctx.applied_operations.contains(&req.idempotency_key)
    {
        return Err(rejected_response(
            req,
            RejectionReason::DuplicateOperation {
                operation_id: req.operation_id.clone(),
            },
        ));
    }

    // 6. Bounded deadline.
    if ctx.deadline_expired {
        return Err(rejected_response(req, RejectionReason::DeadlineExpired));
    }

    Ok(ControlResponse {
        schema_version: req.schema_version,
        correlation_id: req.correlation_id.clone(),
        operation_id: req.operation_id.clone(),
        outcome: OperationOutcome::Planned,
        error_code: None,
        error_detail: None,
        payload: serde_json::json!({ "accepted": true }),
    })
}

/// Constant-time comparison to avoid leaking the auth token.
fn subtle_constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut result = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        result |= x ^ y;
    }
    result == 0
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    subtle_constant_time_eq(a, b)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_base_request() -> ControlRequest {
        ControlRequest {
            schema_version: CONTRACT_SCHEMA_VERSION,
            correlation_id: "corr-001".into(),
            operation_id: "op-001".into(),
            idempotency_key: "idem-001".into(),
            config_generation: 5,
            deadline: "2026-12-01T00:00:00Z".into(),
            auth_token: Some("secret-token".into()),
            operation_type: OperationType::ConfigPush,
            payload: serde_json::json!({ "service": "radius" }),
        }
    }

    fn ctx(generation: u64) -> ValidationContext<'static> {
        ValidationContext {
            current_generation: generation,
            expected_auth_token: Some("secret-token"),
            applied_operations: &[],
            deadline_expired: false,
        }
    }

    #[test]
    fn accepts_valid_config_push_request() {
        let req = valid_base_request();
        let res = validate_request(&req, &ctx(5)).unwrap();
        assert_eq!(res.outcome, OperationOutcome::Planned);
        assert_eq!(res.correlation_id, "corr-001");
        assert_eq!(res.operation_id, "op-001");
        assert!(res.error_code.is_none());
        assert_eq!(res.schema_version, CONTRACT_SCHEMA_VERSION);
    }

    #[test]
    fn rejects_unsupported_version() {
        let mut req = valid_base_request();
        req.schema_version = 99;
        let res = validate_request(&req, &ctx(5)).unwrap_err();
        assert_eq!(res.outcome, OperationOutcome::Rejected);
        assert_eq!(res.error_code, Some(ErrorCode::UnsupportedVersion));
        assert!(res.error_detail.is_some());
        assert!(!res.error_detail.as_ref().unwrap().contains("secret"));
    }

    #[test]
    fn rejects_stale_generation() {
        let mut req = valid_base_request();
        req.config_generation = 3; // current is 5
        let res = validate_request(&req, &ctx(5)).unwrap_err();
        assert_eq!(res.error_code, Some(ErrorCode::StaleGeneration));
        let detail = res.error_detail.unwrap();
        assert!(detail.contains("3"));
        assert!(detail.contains("5"));
    }

    #[test]
    fn rejects_duplicate_operation() {
        let req = valid_base_request();
        let applied = ["op-001".to_string()];
        let mut ctx = ctx(5);
        ctx.applied_operations = &applied;
        let res = validate_request(&req, &ctx).unwrap_err();
        assert_eq!(res.error_code, Some(ErrorCode::DuplicateOperation));
    }

    #[test]
    fn rejects_auth_failure() {
        let mut req = valid_base_request();
        req.auth_token = Some("wrong-token".into());
        let res = validate_request(&req, &ctx(5)).unwrap_err();
        assert_eq!(res.error_code, Some(ErrorCode::AuthFailure));
    }

    #[test]
    fn rejects_missing_auth_token() {
        let mut req = valid_base_request();
        req.auth_token = None;
        let res = validate_request(&req, &ctx(5)).unwrap_err();
        assert_eq!(res.error_code, Some(ErrorCode::AuthFailure));
    }

    #[test]
    fn rejects_expired_deadline() {
        let req = valid_base_request();
        let mut ctx = ctx(5);
        ctx.deadline_expired = true;
        let res = validate_request(&req, &ctx).unwrap_err();
        assert_eq!(res.error_code, Some(ErrorCode::DeadlineExpired));
    }

    #[test]
    fn rejects_empty_correlation_id() {
        let mut req = valid_base_request();
        req.correlation_id = "".into();
        let res = validate_request(&req, &ctx(5)).unwrap_err();
        assert_eq!(res.error_code, Some(ErrorCode::InvalidPayload));
    }

    #[test]
    fn error_detail_is_redacted_no_secrets_leak() {
        let mut req = valid_base_request();
        req.schema_version = 99;
        let res = validate_request(&req, &ctx(5)).unwrap_err();
        let detail = res.error_detail.unwrap();
        assert!(!detail.contains("secret-token"));
        assert!(!detail.contains("secret"));
    }

    #[test]
    fn serializes_request_and_response_round_trip() {
        let req = valid_base_request();
        let json = serde_json::to_string(&req).unwrap();
        let parsed: ControlRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, req);

        let res = validate_request(&req, &ctx(5)).unwrap();
        let json = serde_json::to_string(&res).unwrap();
        let parsed: ControlResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, res);
    }

    #[test]
    fn health_signal_variants_are_distinct() {
        assert!(matches!(
            OperationType::HealthQuery,
            OperationType::HealthQuery
        ));
        assert_ne!(HealthSignal::Liveness, HealthSignal::Readiness);
        assert_ne!(
            HealthSignal::ManagementReachability,
            HealthSignal::ProtocolHealth
        );
    }
}
