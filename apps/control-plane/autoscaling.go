package main

import (
	"errors"
	"fmt"
	"time"
)

// AutoscalingPolicy defines bounds, thresholds, and cooldowns for horizontal scaling.
type AutoscalingPolicy struct {
	MinReplicas         int           `json:"minReplicas"`
	MaxReplicas         int           `json:"maxReplicas"`
	TargetCPUPercent    float64       `json:"targetCpuPercent"`
	TargetMemoryPercent float64       `json:"targetMemoryPercent"`
	ScaleDownThreshold  float64       `json:"scaleDownThreshold"`
	ScaleUpStep         int           `json:"scaleUpStep"`
	ScaleDownStep       int           `json:"scaleDownStep"`
	ScaleUpCooldown     time.Duration `json:"scaleUpCooldown"`
	ScaleDownCooldown   time.Duration `json:"scaleDownCooldown"`
}

// AutoscalingMetrics captures observed replica count and resource utilization.
type AutoscalingMetrics struct {
	CurrentReplicas int       `json:"currentReplicas"`
	CPUPercent      float64   `json:"cpuPercent"`
	MemoryPercent   float64   `json:"memoryPercent"`
	LastScaleAt     time.Time `json:"lastScaleAt"`
	Now             time.Time `json:"now"`
}

// AutoscalingDecision is the deterministic output of EvaluateAutoscalingPolicy.
type AutoscalingDecision struct {
	Action          string `json:"action"` // "scale_up", "scale_down", or "noop"
	DesiredReplicas int    `json:"desiredReplicas"`
	Reason          string `json:"reason"`
}

// Validate enforces fail-closed invariants on an AutoscalingPolicy.
func (p AutoscalingPolicy) Validate() error {
	if p.MinReplicas < 1 {
		return errors.New("minReplicas must be >= 1")
	}
	if p.MaxReplicas < p.MinReplicas {
		return fmt.Errorf("maxReplicas (%d) must be >= minReplicas (%d)", p.MaxReplicas, p.MinReplicas)
	}
	if p.TargetCPUPercent <= 0 || p.TargetCPUPercent > 100 {
		return fmt.Errorf("targetCpuPercent must be in (0, 100], got %.2f", p.TargetCPUPercent)
	}
	if p.TargetMemoryPercent <= 0 || p.TargetMemoryPercent > 100 {
		return fmt.Errorf("targetMemoryPercent must be in (0, 100], got %.2f", p.TargetMemoryPercent)
	}
	if p.ScaleDownThreshold < 0 || p.ScaleDownThreshold >= p.TargetCPUPercent || p.ScaleDownThreshold >= p.TargetMemoryPercent {
		return fmt.Errorf("scaleDownThreshold (%.2f) must be >= 0 and below target thresholds", p.ScaleDownThreshold)
	}
	if p.ScaleUpCooldown < 0 || p.ScaleDownCooldown < 0 {
		return errors.New("cooldowns must be non-negative")
	}
	return nil
}

// EvaluateAutoscalingPolicy computes the next replica count given a policy and metrics.
func EvaluateAutoscalingPolicy(policy AutoscalingPolicy, metrics AutoscalingMetrics) (AutoscalingDecision, error) {
	if err := policy.Validate(); err != nil {
		return AutoscalingDecision{}, err
	}
	if metrics.CurrentReplicas < 0 {
		return AutoscalingDecision{}, fmt.Errorf("currentReplicas must be >= 0, got %d", metrics.CurrentReplicas)
	}
	if metrics.CPUPercent < 0 || metrics.MemoryPercent < 0 {
		return AutoscalingDecision{}, errors.New("resource utilization percentages must be non-negative")
	}

	now := metrics.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}

	stepUp := policy.ScaleUpStep
	if stepUp <= 0 {
		stepUp = 1
	}
	stepDown := policy.ScaleDownStep
	if stepDown <= 0 {
		stepDown = 1
	}

	// Enforce hard floor/ceiling immediately if current replicas are out of bounds.
	if metrics.CurrentReplicas < policy.MinReplicas {
		return AutoscalingDecision{
			Action:          "scale_up",
			DesiredReplicas: policy.MinReplicas,
			Reason:          "below minReplicas floor",
		}, nil
	}
	if metrics.CurrentReplicas > policy.MaxReplicas {
		return AutoscalingDecision{
			Action:          "scale_down",
			DesiredReplicas: policy.MaxReplicas,
			Reason:          "above maxReplicas ceiling",
		}, nil
	}

	needsScaleUp := metrics.CPUPercent >= policy.TargetCPUPercent || metrics.MemoryPercent >= policy.TargetMemoryPercent
	if needsScaleUp {
		if metrics.CurrentReplicas >= policy.MaxReplicas {
			return AutoscalingDecision{
				Action:          "noop",
				DesiredReplicas: metrics.CurrentReplicas,
				Reason:          "at maxReplicas ceiling",
			}, nil
		}
		if !metrics.LastScaleAt.IsZero() && now.Sub(metrics.LastScaleAt) < policy.ScaleUpCooldown {
			return AutoscalingDecision{
				Action:          "noop",
				DesiredReplicas: metrics.CurrentReplicas,
				Reason:          "scale_up cooldown active",
			}, nil
		}
		desired := metrics.CurrentReplicas + stepUp
		if desired > policy.MaxReplicas {
			desired = policy.MaxReplicas
		}
		return AutoscalingDecision{
			Action:          "scale_up",
			DesiredReplicas: desired,
			Reason:          "utilization exceeded target threshold",
		}, nil
	}

	scaleDownThresh := policy.ScaleDownThreshold
	if scaleDownThresh > 0 && metrics.CPUPercent <= scaleDownThresh && metrics.MemoryPercent <= scaleDownThresh {
		if metrics.CurrentReplicas <= policy.MinReplicas {
			return AutoscalingDecision{
				Action:          "noop",
				DesiredReplicas: metrics.CurrentReplicas,
				Reason:          "at minReplicas floor",
			}, nil
		}
		if !metrics.LastScaleAt.IsZero() && now.Sub(metrics.LastScaleAt) < policy.ScaleDownCooldown {
			return AutoscalingDecision{
				Action:          "noop",
				DesiredReplicas: metrics.CurrentReplicas,
				Reason:          "scale_down cooldown active",
			}, nil
		}
		desired := metrics.CurrentReplicas - stepDown
		if desired < policy.MinReplicas {
			desired = policy.MinReplicas
		}
		return AutoscalingDecision{
			Action:          "scale_down",
			DesiredReplicas: desired,
			Reason:          "utilization below scale-down threshold",
		}, nil
	}

	return AutoscalingDecision{
		Action:          "noop",
		DesiredReplicas: metrics.CurrentReplicas,
		Reason:          "within target utilization band",
	}, nil
}
