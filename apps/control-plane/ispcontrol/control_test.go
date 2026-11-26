package ispcontrol

import (
	"context"
	"strings"
	"testing"
)

func TestPolicyAndRouterDispatch(t *testing.T) {
	policy := DefaultPolicy()
	router := NewRouter(policy,
		NewSimulatorAdapter(ResourceNAS, OperationInspect, OperationPlan),
	)
	valid := OperationRequest{
		TenantID: "tenant-a", ResourceKind: ResourceNAS, Operation: OperationInspect,
		ResourceID: "nas-1", CorrelationID: "corr-1", OperationID: "op-1",
	}
	got, opErr := router.Execute(context.Background(), valid)
	if opErr != nil {
		t.Fatalf("valid operation rejected: %v", opErr)
	}
	if got.Status != "planned" || !got.Simulated || got.TenantID != valid.TenantID {
		t.Fatalf("unexpected result: %+v", got)
	}
	if opErr := policy.Validate(OperationRequest{}); opErr == nil || opErr.Code != ErrorInvalidRequest {
		t.Fatalf("empty request should fail validation: %v", opErr)
	}
	unsupported := valid
	unsupported.ResourceKind = ResourceKind("olt")
	if _, opErr := router.Execute(context.Background(), unsupported); opErr == nil || opErr.Code != ErrorUnsupportedKind {
		t.Fatalf("unsupported kind should fail closed: %v", opErr)
	}
	unregistered := valid
	unregistered.ResourceKind = ResourceSubscriber
	if _, opErr := router.Execute(context.Background(), unregistered); opErr == nil || opErr.Code != ErrorAdapterUnavailable {
		t.Fatalf("unregistered adapter should fail closed: %v", opErr)
	}
}

func TestSimulatorAdapterDoesNotAcceptMissingResourceID(t *testing.T) {
	adapter := NewSimulatorAdapter(ResourceNAS, OperationInspect)
	_, err := adapter.Plan(context.Background(), OperationRequest{
		TenantID: "tenant-a", ResourceKind: ResourceNAS, Operation: OperationInspect,
	})
	if err == nil || !strings.Contains(err.Error(), "resource id missing") {
		t.Fatalf("expected missing resource id failure, got %v", err)
	}
}
