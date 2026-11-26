package ispcontrol

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// ReadinessReport is a bounded, non-sensitive snapshot of the stateless ISP
// control module. It never includes device credentials, topology or business
// records.
type ReadinessReport struct {
	Status          string          `json:"status"`
	Stateless       bool            `json:"stateless"`
	AdapterCount    int             `json:"adapter_count"`
	RegisteredKinds []ResourceKind  `json:"registered_kinds"`
	Signals         map[string]bool `json:"signals"`
}

// Readiness builds a report from in-process registration state only. Liveness,
// readiness, management reachability and protocol health remain separate
// signals per ADR 0019.
func (r *Router) Readiness(ctx context.Context) ReadinessReport {
	signals := map[string]bool{
		"liveness":                true,
		"readiness":               len(r.adapters) > 0,
		"management_reachability": false,
		"protocol_health":         false,
	}
	status := "ready"
	if !signals["readiness"] || ctx.Err() != nil {
		status = "not_ready"
	}
	kinds := make([]ResourceKind, 0, len(r.adapters))
	for kind := range r.adapters {
		kinds = append(kinds, kind)
	}
	sortResourceKinds(kinds)
	return ReadinessReport{
		Status: status, Stateless: true, AdapterCount: len(r.adapters),
		RegisteredKinds: kinds, Signals: signals,
	}
}

func sortResourceKinds(kinds []ResourceKind) {
	for i := 1; i < len(kinds); i++ {
		for j := i; j > 0 && kinds[j] < kinds[j-1]; j-- {
			kinds[j], kinds[j-1] = kinds[j-1], kinds[j]
		}
	}
}

// Handler exposes a typed HTTP surface for the control package. It has no
// database handle, no device client and no mutable business state.
type Handler struct {
	router  *Router
	timeout time.Duration
}

// NewHandler builds the ISP control HTTP handler.
func NewHandler(router *Router, timeout time.Duration) *Handler {
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return &Handler{router: router, timeout: timeout}
}

// HandleHealth returns liveness only; no dependency probes or business data.
func (h *Handler) HandleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "module": "isp-control"})
}

// HandleReadiness returns registration-based readiness and separate signals.
func (h *Handler) HandleReadiness(w http.ResponseWriter, r *http.Request) {
	report := h.router.Readiness(r.Context())
	status := http.StatusOK
	if report.Status != "ready" {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, report)
}

// HandleOperation accepts one typed, bounded operation and maps OperationError
// values to stable HTTP statuses and JSON error codes.
func (h *Handler) HandleOperation(w http.ResponseWriter, r *http.Request) {
	var req OperationRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeError(w, &OperationError{Code: ErrorInvalidRequest, Message: "invalid JSON request", Status: http.StatusBadRequest})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()
	result, opErr := h.router.Execute(ctx, req)
	if opErr != nil {
		writeError(w, opErr)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func writeError(w http.ResponseWriter, err *OperationError) {
	writeJSON(w, err.HTTPStatus(), map[string]string{"error": string(err.Code), "message": err.Message})
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
