package main

import (
	"testing"
	"time"
)

func TestEvaluateAutoscalingPolicy(t *testing.T) {
	basePolicy := AutoscalingPolicy{
		MinReplicas:         2,
		MaxReplicas:         6,
		TargetCPUPercent:    75,
		TargetMemoryPercent: 80,
		ScaleDownThreshold:  30,
		ScaleUpStep:         2,
		ScaleDownStep:       1,
		ScaleUpCooldown:     2 * time.Minute,
		ScaleDownCooldown:   5 * time.Minute,
	}
	now := time.Date(2026, 11, 27, 10, 0, 0, 0, time.UTC)

	t.Run("scales up on high CPU and clamps to max", func(t *testing.T) {
		dec, err := EvaluateAutoscalingPolicy(basePolicy, AutoscalingMetrics{
			CurrentReplicas: 5,
			CPUPercent:      82,
			MemoryPercent:   40,
			LastScaleAt:     now.Add(-10 * time.Minute),
			Now:             now,
		})
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if dec.Action != "scale_up" || dec.DesiredReplicas != 6 {
			t.Fatalf("got %+v, want scale_up to 6", dec)
		}
	})

	t.Run("respects scale up cooldown", func(t *testing.T) {
		dec, err := EvaluateAutoscalingPolicy(basePolicy, AutoscalingMetrics{
			CurrentReplicas: 3,
			CPUPercent:      90,
			MemoryPercent:   50,
			LastScaleAt:     now.Add(-30 * time.Second),
			Now:             now,
		})
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if dec.Action != "noop" || dec.DesiredReplicas != 3 {
			t.Fatalf("got %+v, want noop at 3", dec)
		}
	})

	t.Run("scales down when both CPU and memory are low", func(t *testing.T) {
		dec, err := EvaluateAutoscalingPolicy(basePolicy, AutoscalingMetrics{
			CurrentReplicas: 4,
			CPUPercent:      15,
			MemoryPercent:   25,
			LastScaleAt:     now.Add(-10 * time.Minute),
			Now:             now,
		})
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if dec.Action != "scale_down" || dec.DesiredReplicas != 3 {
			t.Fatalf("got %+v, want scale_down to 3", dec)
		}
	})

	t.Run("enforces floor when below minReplicas", func(t *testing.T) {
		dec, err := EvaluateAutoscalingPolicy(basePolicy, AutoscalingMetrics{
			CurrentReplicas: 1,
			CPUPercent:      10,
			MemoryPercent:   10,
			Now:             now,
		})
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if dec.Action != "scale_up" || dec.DesiredReplicas != 2 {
			t.Fatalf("got %+v, want scale_up to 2", dec)
		}
	})

	t.Run("rejects invalid policy fail-closed", func(t *testing.T) {
		bad := basePolicy
		bad.MaxReplicas = 1
		if _, err := EvaluateAutoscalingPolicy(bad, AutoscalingMetrics{CurrentReplicas: 2, Now: now}); err == nil {
			t.Fatal("expected error for maxReplicas < minReplicas")
		}
	})
}
