// Package isp defines the Go side of the versioned Go-to-Rust ISP runtime
// control contract.
//
// These structs mirror the serde envelopes in apps/isp/src/control_contract.rs
// (docs/decisions/0019-isp-rust-go-boundaries.md, section "Go-to-Rust
// contract", and roadmap task M19.02): a versioned private contract with
// authenticated transport, bounded deadline, correlation ID, operation ID,
// idempotency key, config generation, typed outcome, redacted errors and
// replay-safe event identity.
package isp

import (
	"crypto/subtle"
	"encoding/json"
)

// ContractSchemaVersion is the current contract schema version. Receivers
// reject envelopes whose schema_version differs (unsupported version).
const ContractSchemaVersion uint16 = 1

// OperationType enumerates the control operations relevant to RADIUS/DHCP/DNS
// service control. Values match the Rust OperationType snake_case serde.
type OperationType string

const (
	OperationConfigPush      OperationType = "config_push"
	OperationConfigAck       OperationType = "config_ack"
	OperationHealthQuery     OperationType = "health_query"
	OperationOperationStatus OperationType = "operation_status"
)

// OperationOutcome enumerates typed outcomes. Values match the Rust
// OperationOutcome snake_case serde.
type OperationOutcome string

const (
	OutcomePlanned      OperationOutcome = "planned"
	OutcomeApplied      OperationOutcome = "applied"
	OutcomeAcknowledged OperationOutcome = "acknowledged"
	OutcomeRejected     OperationOutcome = "rejected"
	OutcomeTimedOut     OperationOutcome = "timed_out"
	OutcomeDrifted      OperationOutcome = "drifted"
	OutcomeRolledBack   OperationOutcome = "rolled_back"
)

// HealthSignal enumerates separate health signals. Values match the Rust
// HealthSignal snake_case serde.
type HealthSignal string

const (
	HealthSignalLiveness               HealthSignal = "liveness"
	HealthSignalReadiness              HealthSignal = "readiness"
	HealthSignalManagementReachability HealthSignal = "management_reachability"
	HealthSignalProtocolHealth         HealthSignal = "protocol_health"
)

// ErrorCode enumerates typed error codes. Values match the Rust ErrorCode
// snake_case serde.
type ErrorCode string

const (
	ErrorUnsupportedVersion ErrorCode = "unsupported_version"
	ErrorStaleGeneration    ErrorCode = "stale_generation"
	ErrorDuplicateOperation ErrorCode = "duplicate_operation"
	ErrorAuthFailure        ErrorCode = "auth_failure"
	ErrorDeadlineExpired    ErrorCode = "deadline_expired"
	ErrorInvalidPayload     ErrorCode = "invalid_payload"
	ErrorInternalError      ErrorCode = "internal_error"
)

// ControlRequest is the versioned request envelope sent from Go to a Rust ISP
// runtime. Field names and types match the Rust ControlRequest.
type ControlRequest struct {
	SchemaVersion    uint16          `json:"schema_version"`
	CorrelationID    string          `json:"correlation_id"`
	OperationID      string          `json:"operation_id"`
	IdempotencyKey   string          `json:"idempotency_key"`
	ConfigGeneration uint64          `json:"config_generation"`
	Deadline         string          `json:"deadline"`
	AuthToken        *string         `json:"auth_token"`
	OperationType    OperationType   `json:"operation_type"`
	Payload          json.RawMessage `json:"payload"`
}

// ControlResponse is the versioned response envelope returned by a Rust ISP
// runtime. Field names and types match the Rust ControlResponse.
type ControlResponse struct {
	SchemaVersion uint16           `json:"schema_version"`
	CorrelationID string           `json:"correlation_id"`
	OperationID   string           `json:"operation_id"`
	Outcome       OperationOutcome `json:"outcome"`
	ErrorCode     *ErrorCode       `json:"error_code"`
	ErrorDetail   *string          `json:"error_detail"`
	Payload       json.RawMessage  `json:"payload"`
}

// ValidationContext is the Go mirror of the Rust ValidationContext.
type ValidationContext struct {
	CurrentGeneration uint64
	ExpectedAuthToken string
	AppliedOperations []string
	DeadlineExpired   bool
}

// ValidationError pairs a typed error code with a redacted detail string.
type ValidationError struct {
	Code   ErrorCode
	Detail string
}

// Error implements the error interface.
func (e *ValidationError) Error() string {
	return string(e.Code) + ": " + e.Detail
}

func rejectedResponse(req *ControlRequest, code ErrorCode, detail string) *ControlResponse {
	c := code
	d := detail
	return &ControlResponse{
		SchemaVersion: req.SchemaVersion,
		CorrelationID: req.CorrelationID,
		OperationID:   req.OperationID,
		Outcome:       OutcomeRejected,
		ErrorCode:     &c,
		ErrorDetail:   &d,
		Payload:       json.RawMessage(`{}`),
	}
}

// constantTimeEqual compares two strings in constant time to avoid leaking the
// transport token through timing.
func constantTimeEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// ValidateRequest applies the same rules as the Rust validate_request: schema
// version, authenticated transport, required identity fields, stale
// generation, duplicate operation/idempotency key, and bounded deadline. It
// returns a response for every input; the outcome field distinguishes accepted
// (planned) from rejected.
func ValidateRequest(req *ControlRequest, ctx ValidationContext) (*ControlResponse, error) {
	if req.SchemaVersion != ContractSchemaVersion {
		return rejectedResponse(req, ErrorUnsupportedVersion, "unsupported contract schema version"), &ValidationError{
			Code:   ErrorUnsupportedVersion,
			Detail: "unsupported contract schema version",
		}
	}

	// Authenticated transport.
	authed := req.AuthToken != nil && constantTimeEqual(*req.AuthToken, ctx.ExpectedAuthToken)
	if !authed {
		return rejectedResponse(req, ErrorAuthFailure, "authentication failure"), &ValidationError{
			Code:   ErrorAuthFailure,
			Detail: "authentication failure",
		}
	}

	// Required identity fields.
	if req.CorrelationID == "" {
		return rejectedResponse(req, ErrorInvalidPayload, "invalid payload field: correlation_id"), &ValidationError{
			Code:   ErrorInvalidPayload,
			Detail: "invalid payload field: correlation_id",
		}
	}
	if req.OperationID == "" {
		return rejectedResponse(req, ErrorInvalidPayload, "invalid payload field: operation_id"), &ValidationError{
			Code:   ErrorInvalidPayload,
			Detail: "invalid payload field: operation_id",
		}
	}
	if req.IdempotencyKey == "" {
		return rejectedResponse(req, ErrorInvalidPayload, "invalid payload field: idempotency_key"), &ValidationError{
			Code:   ErrorInvalidPayload,
			Detail: "invalid payload field: idempotency_key",
		}
	}

	// Stale config generation.
	if req.ConfigGeneration < ctx.CurrentGeneration {
		return rejectedResponse(req, ErrorStaleGeneration, "stale config generation"), &ValidationError{
			Code:   ErrorStaleGeneration,
			Detail: "stale config generation",
		}
	}

	// Duplicate operation / idempotency key.
	for _, applied := range ctx.AppliedOperations {
		if applied == req.OperationID || applied == req.IdempotencyKey {
			return rejectedResponse(req, ErrorDuplicateOperation, "duplicate operation id"), &ValidationError{
				Code:   ErrorDuplicateOperation,
				Detail: "duplicate operation id",
			}
		}
	}

	// Bounded deadline.
	if ctx.DeadlineExpired {
		return rejectedResponse(req, ErrorDeadlineExpired, "operation deadline expired"), &ValidationError{
			Code:   ErrorDeadlineExpired,
			Detail: "operation deadline expired",
		}
	}

	return &ControlResponse{
		SchemaVersion: req.SchemaVersion,
		CorrelationID: req.CorrelationID,
		OperationID:   req.OperationID,
		Outcome:       OutcomePlanned,
		ErrorCode:     nil,
		ErrorDetail:   nil,
		Payload:       json.RawMessage(`{"accepted":true}`),
	}, nil
}
