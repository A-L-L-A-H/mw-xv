package main

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestGitHubWebhookPersistenceStore(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "paas.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer func() { _ = db.Close() }()

	mgr := NewPaasManager(db, "docker", nil, nil, nil)

	if err := mgr.recordGitHubWebhookDelivery("demo-app", "push", "deliv-1", "refs/heads/main", "deployed", "sha=abc1234"); err != nil {
		t.Fatalf("record delivery 1: %v", err)
	}
	if err := mgr.recordGitHubWebhookDelivery("demo-app", "push", "deliv-2", "refs/heads/main", "ignored", "non-matching branch"); err != nil {
		t.Fatalf("record delivery 2: %v", err)
	}

	deliveries, err := mgr.listGitHubWebhookDeliveries("demo-app", 10)
	if err != nil {
		t.Fatalf("listGitHubWebhookDeliveries: %v", err)
	}
	if len(deliveries) != 2 {
		t.Fatalf("got %d deliveries, want 2", len(deliveries))
	}
	if deliveries[0].DeliveryID != "deliv-2" || deliveries[1].DeliveryID != "deliv-1" {
		t.Fatalf("unexpected delivery order: %+v", deliveries)
	}
}
