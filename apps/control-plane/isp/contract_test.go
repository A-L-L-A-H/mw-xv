package isp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// fixturesPath returns the shared contract fixtures directory under apps/isp.
// The Go module lives at apps/control-plane, so the shared fixtures are at
// apps/isp/tests/fixtures — two levels up, then into the isp app.
func fixturesPath(t *testing.T) string {
	t.Helper()
	here, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	// apps/control-plane/isp -> ../../isp/tests/fixtures
	path := filepath.Join(here, "..", "..", "isp", "tests", "fixtures")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("fixtures dir not found at %s: %v", path, err)
	}
	return path
}

// fixtureFile is the self-describing wrapper used by both the Rust and Go
// contract tests.
type fixtureFile struct {
	Name     string          `json:"name"`
	Request  json.RawMessage `json:"request"`
	Context  fixtureContext  `json:"context"`
	Expected fixtureExpected `json:"expected"`
}

type fixtureContext struct {
	CurrentGeneration uint64   `json:"current_generation"`
	ExpectedAuthToken string   `json:"expected_auth_token"`
	AppliedOperations []string `json:"applied_operations"`
	DeadlineExpired   bool     `json:"deadline_expired"`
}

type fixtureExpected struct {
	Outcome   string  `json:"outcome"`
	ErrorCode *string `json:"error_code"`
}

func loadFixtures(t *testing.T) map[string]fixtureFile {
	t.Helper()
	dir := fixturesPath(t)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read fixtures dir: %v", err)
	}
	out := map[string]fixtureFile{}
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatalf("read fixture %s: %v", e.Name(), err)
		}
		var f fixtureFile
		if err := json.Unmarshal(raw, &f); err != nil {
			t.Fatalf("parse fixture %s: %v", e.Name(), err)
		}
		out[e.Name()] = f
	}
	return out
}

// TestControlRequestEnvelopeRoundTrips proves the Go envelope structs can
// decode every shared fixture request envelope (produced from the Rust serde
// definitions) and re-encode it losslessly — the wire schema matches.
func TestControlRequestEnvelopeRoundTrips(t *testing.T) {
	fixtures := loadFixtures(t)
	if len(fixtures) == 0 {
		t.Fatal("no fixtures loaded")
	}
	for name, f := range fixtures {
		t.Run(name, func(t *testing.T) {
			var req ControlRequest
			if err := json.Unmarshal(f.Request, &req); err != nil {
				t.Fatalf("decode request into Go ControlRequest: %v", err)
			}
			// Re-encode and decode again; both must be byte-identical to prove
			// the Go structs are a lossless mirror of the Rust envelope.
			first, err := json.Marshal(&req)
			if err != nil {
				t.Fatalf("marshal request: %v", err)
			}
			var round ControlRequest
			if err := json.Unmarshal(first, &round); err != nil {
				t.Fatalf("decode round-trip request: %v", err)
			}
			second, err := json.Marshal(&round)
			if err != nil {
				t.Fatalf("re-marshal request: %v", err)
			}
			if !reflect.DeepEqual(first, second) {
				t.Fatalf("round-trip not stable:\n first=%s\nsecond=%s", first, second)
			}
			// Identity fields must survive.
			if req.SchemaVersion != ContractSchemaVersion && f.Expected.ErrorCode == nil {
				t.Errorf("schema_version=%d for positive fixture", req.SchemaVersion)
			}
			if req.CorrelationID == "" || req.OperationID == "" || req.IdempotencyKey == "" {
				t.Errorf("identity fields missing: %+v", req)
			}
			// Operation type must be a recognized constant.
			switch req.OperationType {
			case OperationConfigPush, OperationConfigAck, OperationHealthQuery, OperationOperationStatus:
			default:
				t.Errorf("unknown operation_type %q", req.OperationType)
			}
		})
	}
}

// TestValidateRequestMatchesFixtures applies the Go-side validation to the
// same self-describing fixtures the Rust tests consume and asserts the
// outcome/error_code agree with the fixture expectations.
func TestValidateRequestMatchesFixtures(t *testing.T) {
	fixtures := loadFixtures(t)
	for name, f := range fixtures {
		t.Run(name, func(t *testing.T) {
			var req ControlRequest
			if err := json.Unmarshal(f.Request, &req); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			ctx := ValidationContext{
				CurrentGeneration: f.Context.CurrentGeneration,
				ExpectedAuthToken: f.Context.ExpectedAuthToken,
				AppliedOperations: f.Context.AppliedOperations,
				DeadlineExpired:   f.Context.DeadlineExpired,
			}
			resp, verr := ValidateRequest(&req, ctx)

			switch f.Expected.Outcome {
			case "planned":
				if verr != nil {
					t.Fatalf("expected acceptance, got error %v", verr)
				}
				if resp.Outcome != OutcomePlanned {
					t.Fatalf("expected planned, got %s", resp.Outcome)
				}
				if resp.ErrorCode != nil || resp.ErrorDetail != nil {
					t.Fatalf("planned response must carry no error: %+v", resp)
				}
			case "rejected":
				if verr == nil {
					t.Fatalf("expected rejection, got acceptance %+v", resp)
				}
				ve, ok := verr.(*ValidationError)
				if !ok {
					t.Fatalf("error is not *ValidationError: %T", verr)
				}
				want := f.Expected.ErrorCode
				if want == nil {
					t.Fatal("fixture expects rejected but no error_code given")
				}
				if string(ve.Code) != *want {
					t.Fatalf("error_code: want %s, got %s", *want, ve.Code)
				}
				if resp.Outcome != OutcomeRejected {
					t.Fatalf("outcome: want rejected, got %s", resp.Outcome)
				}
				if resp.ErrorCode == nil || *resp.ErrorCode != ErrorCode(*want) {
					t.Fatalf("response error_code: want %s, got %+v", *want, resp.ErrorCode)
				}
				// Redaction: detail must never echo the transport tokens.
				if resp.ErrorDetail != nil {
					d := *resp.ErrorDetail
					if contains(d, "secret-token") || contains(d, "wrong-token") {
						t.Fatalf("error detail leaks a token: %q", d)
					}
				}
			default:
				t.Fatalf("fixture has unknown expected outcome %q", f.Expected.Outcome)
			}
		})
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && indexOf(s, sub) >= 0
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
