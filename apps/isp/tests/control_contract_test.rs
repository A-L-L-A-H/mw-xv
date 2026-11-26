//! Contract test for the versioned Go-to-Rust ISP runtime control contract.
//!
//! Every JSON fixture under apps/isp/tests/fixtures/ is self-describing: it
//! carries the request envelope, the validation context it must be evaluated
//! against, and the expected outcome/error code. The Rust test evaluates the
//! fixtures with apps/isp/src/control_contract.rs; the Go test
//! (apps/control-plane/isp) round-trips the same `request` envelope through
//! matching Go structs. Both languages therefore read the exact same fixtures.

use moonwitness_isp::control_contract::{
    validate_request, ControlRequest, ErrorCode, OperationOutcome, ValidationContext,
    CONTRACT_SCHEMA_VERSION,
};
use serde::Deserialize;
use serde_json::Value;
use std::path::PathBuf;

#[derive(Deserialize)]
struct Fixture {
    #[allow(dead_code)]
    name: String,
    request: ControlRequest,
    context: FixtureContext,
    expected: FixtureExpected,
}

#[derive(Deserialize)]
struct FixtureContext {
    current_generation: u64,
    expected_auth_token: String,
    applied_operations: Vec<String>,
    deadline_expired: bool,
}

#[derive(Deserialize)]
struct FixtureExpected {
    outcome: String,
    error_code: Option<String>,
}

fn fixtures_dir() -> PathBuf {
    // CARGO_MANIFEST_DIR is apps/isp for the test target.
    let mut d = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    d.push("tests");
    d.push("fixtures");
    d
}

fn load_fixture(name: &str) -> Fixture {
    let path = fixtures_dir().join(name);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read fixture {}: {}", path.display(), e));
    serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("failed to parse fixture {}: {}", path.display(), e))
}

fn context_of(f: &Fixture) -> ValidationContext<'_> {
    ValidationContext {
        current_generation: f.context.current_generation,
        expected_auth_token: Some(&f.context.expected_auth_token),
        applied_operations: &f.context.applied_operations,
        deadline_expired: f.context.deadline_expired,
    }
}

/// Every fixture (positive and negative) must deserialize into the versioned
/// request envelope with the current schema version present as a field.
#[test]
fn all_fixtures_deserialize_into_the_versioned_envelope() {
    for name in fixture_names() {
        let f = load_fixture(name);
        // schema_version must survive deserialization for every fixture,
        // including unsupported-version negatives (so the receiver can echo it).
        assert!(f.request.schema_version >= 1, "{}", name);
        assert!(f.request.deadline.contains('T'), "{}", name);
    }
}

#[test]
fn positive_fixtures_are_accepted_as_planned() {
    for name in [
        "config_push_positive.json",
        "config_ack_positive.json",
        "health_query_positive.json",
        "operation_status_positive.json",
    ] {
        let f = load_fixture(name);
        let res = match validate_request(&f.request, &context_of(&f)) {
            Ok(res) => res,
            Err(rej) => panic!(
                "positive fixture {} was rejected: {:?} detail={:?}",
                name, rej.error_code, rej.error_detail
            ),
        };
        assert_eq!(res.outcome, OperationOutcome::Planned, "{}", name);
        assert_eq!(res.schema_version, CONTRACT_SCHEMA_VERSION, "{}", name);
        assert_eq!(res.correlation_id, f.request.correlation_id, "{}", name);
        assert_eq!(res.operation_id, f.request.operation_id, "{}", name);
        assert!(res.error_code.is_none(), "{}", name);
        assert!(res.error_detail.is_none(), "{}", name);
    }
}

#[test]
fn negative_fixtures_are_rejected_with_typed_error_codes() {
    for name in [
        "negative_stale_generation.json",
        "negative_duplicate_operation.json",
        "negative_unsupported_version.json",
        "negative_timeout_deadline_expired.json",
        "negative_auth_failure.json",
        "negative_missing_auth_token.json",
        "negative_sanitized_error.json",
    ] {
        let f = load_fixture(name);
        let res = validate_request(&f.request, &context_of(&f)).unwrap_err();

        assert_eq!(res.outcome, OperationOutcome::Rejected, "{}", name);
        assert_eq!(
            res.correlation_id, f.request.correlation_id,
            "{} must echo correlation_id",
            name
        );
        assert_eq!(
            res.operation_id, f.request.operation_id,
            "{} must echo operation_id",
            name
        );

        let code = res.error_code.expect("typed error code required");
        assert_eq!(
            serde_json::to_value(code).unwrap(),
            Value::String(f.expected.error_code.clone().unwrap()),
            "{} error code mismatch",
            name
        );

        // Redacted errors: detail must be present and must never echo the
        // transport token (the correct one or the bad one).
        let detail = res.error_detail.as_deref().unwrap_or_default();
        assert!(
            !detail.contains("secret-token") && !detail.contains("wrong-token"),
            "{} leaks a token in error detail: {}",
            name,
            detail
        );
        assert!(!detail.is_empty(), "{} must carry sanitized detail", name);
    }
}

#[test]
fn unsupported_version_fixture_rejects_before_generation_checks() {
    let f = load_fixture("negative_unsupported_version.json");
    let res = validate_request(&f.request, &context_of(&f)).unwrap_err();
    assert_eq!(res.error_code, Some(ErrorCode::UnsupportedVersion));
}

#[test]
fn timeout_class_fixture_maps_to_deadline_expired() {
    let f = load_fixture("negative_timeout_deadline_expired.json");
    let res = validate_request(&f.request, &context_of(&f)).unwrap_err();
    assert_eq!(res.error_code, Some(ErrorCode::DeadlineExpired));
}

fn fixture_names() -> Vec<&'static str> {
    vec![
        "config_push_positive.json",
        "config_ack_positive.json",
        "health_query_positive.json",
        "operation_status_positive.json",
        "negative_stale_generation.json",
        "negative_duplicate_operation.json",
        "negative_unsupported_version.json",
        "negative_timeout_deadline_expired.json",
        "negative_auth_failure.json",
        "negative_missing_auth_token.json",
        "negative_sanitized_error.json",
    ]
}
