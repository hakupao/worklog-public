// Package model holds the records the collector sends: tasks, sessions and notes, with pydantic's
// field order and nulls (spec §5.2).
package model

import "github.com/hakupao/worklog/collector/internal/py/pytime"

// Artifact is one Artifact page a session published: {url, title, artifact_id, ts}.
type Artifact struct {
	URL               string
	Title, ArtifactID *string
	TS                string
}

// Interval is one stretch of work, [start, end] (base.active_intervals).
type Interval [2]pytime.Instant
