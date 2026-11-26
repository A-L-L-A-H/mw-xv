// Package ispcontrol implements the M19.09 ISP network control module inside
// apps/control-plane. It deliberately contains only vendor-neutral contracts,
// policy decisions and simulator adapters: authoritative state remains in
// PostgreSQL/ORM and protocol runtimes remain in Rust.
package ispcontrol

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

// ResourceKind identifies a vendor-neutral ISP resource family.
type ResourceKind string

const (
	ResourceNAS        ResourceKind = "nas"
	ResourceSubscriber ResourceKind = "subscriber"
	ResourceProfile    ResourceKind = "profile"
)

// OperationVerb identifies a control operation on a resource.
type OperationVerb string

const (
	OperationInspect OperationVerb = "inspect"
	OperationPlan    OperationVerb = "plan"
)

// OperationRequest is a bounded, typed request for one ISP control operation.
// TenantID and correlation/operation identity are mandatory; payloads are
// vendor-neutral JSON objects, never arbitrary CLI strings.
type OperationRequest struct {
	TenantID      string          `json:"tenant_id"`
	ResourceKind  ResourceKind    `json:"resource_kind"`
	Operation     OperationVerb   `json:"operation"`
	ResourceID    string          `json:"resource_id,omitempty"`
	CorrelationID string          `json:"correlation_id"`
	OperationID   string          `json:"operation_id"`
	Payload       json.RawMessage `json:"payload,omitempty"`
}

// OperationResult is the response body for an accepted operation.
type OperationResult struct {
	TenantID       string          `json:"tenant_id"`
	ResourceKind   ResourceKind    `json:"resource_kind"`
	Operation      OperationVerb   `json:"operation"`
	OperationID    string          `json:"operation_id"`
	CorrelationID  string          `json:"correlation_id"`
	Status         string          `json:"status"`
	Simulated      bool            `json:"simulated"`
	ChangesPlanned int             `json:"changes_planned,omitempty"`
	Payload        json.RawMessage `json:"payload,omitempty"`
}

// ErrorCode is the stable machine-readable ISP control error class.
type ErrorCode string

const (
	ErrorInvalidRequest     ErrorCode = "invalid_request"
	ErrorUnsupportedKind    ErrorCode = "unsupported_resource_kind"
	ErrorUnsupportedAction  ErrorCode = "unsupported_operation"
	ErrorTenantMismatch     ErrorCode = "tenant_mismatch"
	ErrorAdapterUnavailable ErrorCode = "adapter_unavailable"
	ErrorBackendFailure     ErrorCode = "backend_failure"
)

// OperationError is a typed, redacted control-plane error.
type OperationError struct {
	Code    ErrorCode
	Message string
	Status  int
}

func (e *OperationError) Error() string { return string(e.Code) + ": " + e.Message }

// HTTPStatus maps a typed error to a stable HTTP status.
func (e *OperationError) HTTPStatus() int {
	if e == nil || e.Status == 0 {
		return http.StatusInternalServerError
	}
	return e.Status
}

// Adapter is the narrow, capability-scoped boundary used by ISP control
// handlers. M19.09 registers only read-only simulator adapters; no real device
// or database writes are possible through this package.
type Adapter interface {
	Kind() ResourceKind
	Capabilities() []OperationVerb
	Plan(ctx context.Context, req OperationRequest) (OperationResult, error)
}

// Policy decides whether a request may be admitted before any adapter call.
type Policy struct {
	AllowedKinds       map[ResourceKind]bool
	ReadOnlyOperations map[OperationVerb]bool
	MaxTenantIDLength  int
}

// DefaultPolicy admits only vendor-neutral inspection/planning for NAS,
// subscriber and profile resources. Writes and unknown verbs fail closed.
func DefaultPolicy() Policy {
	return Policy{
		AllowedKinds: map[ResourceKind]bool{
			ResourceNAS: true, ResourceSubscriber: true, ResourceProfile: true,
		},
		ReadOnlyOperations: map[OperationVerb]bool{
			OperationInspect: true, OperationPlan: true,
		},
		MaxTenantIDLength: 128,
	}
}

// Validate enforces policy and bounded request shape without consulting any
// stored business state.
func (p Policy) Validate(req OperationRequest) *OperationError {
	if req.TenantID == "" || len(req.TenantID) > p.MaxTenantIDLength {
		return &OperationError{Code: ErrorInvalidRequest, Message: "tenant_id is required and bounded", Status: http.StatusBadRequest}
	}
	if !p.AllowedKinds[req.ResourceKind] {
		return &OperationError{Code: ErrorUnsupportedKind, Message: "unsupported resource kind", Status: http.StatusBadRequest}
	}
	if !p.ReadOnlyOperations[req.Operation] {
		return &OperationError{Code: ErrorUnsupportedAction, Message: "unsupported operation", Status: http.StatusBadRequest}
	}
	if req.CorrelationID == "" || len(req.CorrelationID) > 128 || req.OperationID == "" || len(req.OperationID) > 128 {
		return &OperationError{Code: ErrorInvalidRequest, Message: "correlation_id and operation_id are required and bounded", Status: http.StatusBadRequest}
	}
	if len(req.Payload) > 8192 {
		return &OperationError{Code: ErrorInvalidRequest, Message: "payload exceeds bound", Status: http.StatusBadRequest}
	}
	return nil
}

// Router dispatches validated operations to registered simulator adapters.
type Router struct {
	policy   Policy
	adapters map[ResourceKind]Adapter
}

// NewRouter builds a stateless router from the supplied adapters.
func NewRouter(policy Policy, adapters ...Adapter) *Router {
	r := &Router{policy: policy, adapters: make(map[ResourceKind]Adapter, len(adapters))}
	for _, a := range adapters {
		r.adapters[a.Kind()] = a
	}
	return r
}

// Execute validates the request and invokes the adapter capability; it never
// performs device I/O or local persistence.
func (r *Router) Execute(ctx context.Context, req OperationRequest) (OperationResult, *OperationError) {
	if err := r.policy.Validate(req); err != nil {
		return OperationResult{}, err
	}
	adapter, ok := r.adapters[req.ResourceKind]
	if !ok {
		return OperationResult{}, &OperationError{Code: ErrorAdapterUnavailable, Message: "adapter not registered", Status: http.StatusServiceUnavailable}
	}
	supported := false
	for _, capability := range adapter.Capabilities() {
		if capability == req.Operation {
			supported = true
			break
		}
	}
	if !supported {
		return OperationResult{}, &OperationError{Code: ErrorUnsupportedAction, Message: "adapter capability not registered", Status: http.StatusBadRequest}
	}
	if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) <= 0 {
		return OperationResult{}, &OperationError{Code: ErrorBackendFailure, Message: "operation deadline expired", Status: http.StatusGatewayTimeout}
	}
	result, err := adapter.Plan(ctx, req)
	if err != nil {
		return OperationResult{}, &OperationError{Code: ErrorBackendFailure, Message: "simulator adapter failed", Status: http.StatusBadGateway}
	}
	return result, nil
}

// SimulatorAdapter is a read-only, in-memory adapter used for contract tests
// and non-production control-plane operation. It performs no device calls.
type SimulatorAdapter struct {
	kind         ResourceKind
	capabilities []OperationVerb
}

// NewSimulatorAdapter constructs an adapter with an explicit, fixed capability
// set.
func NewSimulatorAdapter(kind ResourceKind, capabilities ...OperationVerb) *SimulatorAdapter {
	return &SimulatorAdapter{kind: kind, capabilities: capabilities}
}

func (a *SimulatorAdapter) Kind() ResourceKind { return a.kind }

func (a *SimulatorAdapter) Capabilities() []OperationVerb {
	out := make([]OperationVerb, len(a.capabilities))
	copy(out, a.capabilities)
	return out
}

func (a *SimulatorAdapter) Plan(_ context.Context, req OperationRequest) (OperationResult, error) {
	if err := ctxTenant(req); err != nil {
		return OperationResult{}, err
	}
	return OperationResult{
		TenantID:       req.TenantID,
		ResourceKind:   req.ResourceKind,
		Operation:      req.Operation,
		OperationID:    req.OperationID,
		CorrelationID:  req.CorrelationID,
		Status:         "planned",
		Simulated:      true,
		ChangesPlanned: 1,
		Payload:        json.RawMessage(`{"source":"simulator"}`),
	}, nil
}

func ctxTenant(req OperationRequest) error {
	if req.TenantID == "" {
		return errors.New("tenant id missing")
	}
	if req.ResourceID == "" {
		return fmt.Errorf("resource id missing for %s", req.ResourceKind)
	}
	return nil
}
