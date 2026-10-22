// Package input is the raw Cursor privacy boundary. No raw values or errors
// escape it; source metadata is deliberately separate from T07 normalized facts.
package input

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"overwatch/helper/internal/output"
)

const (
	MaxInputBytes      = 32 * 1024 * 1024
	MaxProjectionBytes = 16 * 1024
	maxDepth           = 64
	maxFields          = 512
)

// Counters are invocation-local coverage signals, never native action outcomes.
// A future consumer may aggregate these; this package does not log or persist.
type Counters struct {
	UnknownFields   uint32 `json:"unknownFields"`
	SensitiveFields uint32 `json:"sensitiveFields"`
	InvalidFields   uint32 `json:"invalidFields"`
	Gap             string `json:"gap,omitempty"`
}

// Metadata contains only allowlisted enums, bounded numbers and hashed hints.
// PathHash is NOT a canonical file key. Source linkage does not prove ownership.
type Metadata struct {
	Version              int      `json:"metadataVersion"`
	EventID              string   `json:"eventId"`
	SourceEvent          string   `json:"sourceEvent"`
	ReceivedAt           string   `json:"receivedAt"`
	SourceVersion        string   `json:"sourceVersion,omitempty"`
	ConversationID       string   `json:"conversationId,omitempty"`
	GenerationID         string   `json:"generationId,omitempty"`
	SessionID            string   `json:"sessionId,omitempty"`
	CallID               string   `json:"callId,omitempty"`
	ToolCallID           string   `json:"toolCallId,omitempty"`
	ParentConversationID string   `json:"parentConversationId,omitempty"`
	SubagentID           string   `json:"subagentId,omitempty"`
	Tool                 string   `json:"tool"`
	PathHash             string   `json:"pathHash,omitempty"`
	Status               string   `json:"status,omitempty"`
	FailureType          string   `json:"failureType,omitempty"`
	Interrupted          *bool    `json:"interrupted,omitempty"`
	DurationMS           *float64 `json:"durationMs,omitempty"`
}

type Result struct {
	Metadata *Metadata `json:"metadata,omitempty"`
	Counters Counters  `json:"counters"`
}

var versionPattern = regexp.MustCompile(`^[0-9]{1,8}\.[0-9]{1,8}\.[0-9]{1,8}$`)

// ProjectWithEntropy permits deterministic identity-failure testing. Production
// callers use Project, which uses the OS cryptographic random source.
func ProjectWithEntropy(r io.Reader, hook string, entropy io.Reader) Result {
	gap := func(code string) Result { return Result{Counters: Counters{Gap: code}} }
	if !output.Known(hook) {
		return gap("unsupported-hook")
	}
	data, err := io.ReadAll(io.LimitReader(r, MaxInputBytes+1))
	if err != nil {
		return gap("input-read-failed")
	}
	if len(data) > MaxInputBytes {
		return gap("input-too-large")
	}
	if !utf8.Valid(data) {
		return gap("invalid-utf8")
	}
	if !boundedDepth(data) {
		return gap("input-too-deep")
	}
	if !json.Valid(data) {
		return gap("invalid-json")
	}
	var counters Counters
	m := &Metadata{Version: 1, SourceEvent: hook, ReceivedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000Z"), Tool: "unknown"}
	matched := false
	valid := fields(data, func(key string, raw json.RawMessage) {
		switch key {
		case "hook_event_name":
			value, ok := text(raw, 64)
			matched = ok && value == hook
		case "conversation_id":
			m.ConversationID = opaque(raw, "conversation", 256, &counters)
		case "generation_id":
			m.GenerationID = opaque(raw, "generation", 256, &counters)
		case "session_id":
			m.SessionID = opaque(raw, "session", 256, &counters)
		case "tool_use_id":
			m.CallID = opaque(raw, "call", 256, &counters)
		case "tool_call_id":
			m.ToolCallID = opaque(raw, "tool-call", 256, &counters)
		case "parent_conversation_id":
			m.ParentConversationID = opaque(raw, "conversation", 256, &counters)
		case "subagent_id":
			m.SubagentID = opaque(raw, "subagent", 256, &counters)
		case "file_path":
			m.PathHash = opaque(raw, "path-hint", 4096, &counters)
		case "cursor_version":
			if value, ok := text(raw, 64); ok && versionPattern.MatchString(value) {
				m.SourceVersion = value
			} else {
				counters.InvalidFields++
			}
		case "tool_name":
			m.Tool = tool(raw)
		case "status":
			m.Status = enum(raw, &counters, "completed", "aborted", "error")
		case "failure_type":
			m.FailureType = enum(raw, &counters, "timeout", "error", "permission_denied")
		case "is_interrupt":
			var value bool
			if bytes.Equal(raw, []byte("null")) || json.Unmarshal(raw, &value) != nil {
				counters.InvalidFields++
			} else {
				m.Interrupted = &value
			}
		case "duration":
			var value float64
			if bytes.Equal(raw, []byte("null")) || json.Unmarshal(raw, &value) != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 86400000 {
				counters.InvalidFields++
			} else {
				m.DurationMS = &value
			}
		case "tool_input":
			// MCP input is a content-bearing string; never parse that string.
			if len(raw) > 0 && raw[0] == '{' {
				if !fields(raw, func(key string, value json.RawMessage) {
					switch key {
					case "file_path", "path", "target_file":
						// Do not infer precedence between conflicting path aliases.
						_ = value
						counters.SensitiveFields++
					default:
						countDropped(key, &counters)
					}
				}) {
					counters.Gap = "invalid-tool-input"
				}
			} else {
				counters.SensitiveFields++
			}
		case "workspace_roots", "cwd":
			counters.SensitiveFields++
		default:
			countDropped(key, &counters)
		}
	})
	if !valid {
		return gap("invalid-object")
	}
	if !matched {
		return gap("hook-mismatch")
	}
	if counters.Gap != "" {
		return Result{Counters: counters}
	}
	id := make([]byte, 16)
	if _, err := io.ReadFull(entropy, id); err != nil {
		return gap("identity-unavailable")
	}
	id[6] = (id[6] & 15) | 64
	id[8] = (id[8] & 63) | 128
	m.EventID = fmt.Sprintf("%x-%x-%x-%x-%x", id[:4], id[4:6], id[6:8], id[8:10], id[10:])
	result := Result{Metadata: m, Counters: counters}
	encoded, err := json.Marshal(result)
	if err != nil || len(encoded) > MaxProjectionBytes {
		return gap("projection-too-large")
	}
	return result
}

func Project(r io.Reader, hook string) Result { return ProjectWithEntropy(r, hook, rand.Reader) }

func text(raw json.RawMessage, limit int) (string, bool) {
	// Bound before decoding escapes; a single code point uses at most six bytes
	// in escaped JSON. The decoded bound is measured in UTF-8 bytes.
	if len(raw) > limit*6+2 {
		return "", false
	}
	var value string
	// encoding/json replaces unpaired UTF-16 surrogates with U+FFFD. Reject
	// replacement characters rather than merge distinct source identities.
	if json.Unmarshal(raw, &value) != nil || len(value) == 0 || len(value) > limit || strings.ContainsRune(value, utf8.RuneError) || bytes.Equal(raw, []byte("null")) {
		return "", false
	}
	return value, true
}

func opaque(raw json.RawMessage, domain string, limit int, counters *Counters) string {
	value, ok := text(raw, limit)
	if !ok {
		counters.InvalidFields++
		return ""
	}
	digest := sha256.Sum256([]byte(domain + "\x00" + value))
	return hex.EncodeToString(digest[:])
}

func enum(raw json.RawMessage, counters *Counters, allowed ...string) string {
	value, ok := text(raw, 64)
	if ok {
		for _, candidate := range allowed {
			if value == candidate {
				return value
			}
		}
	}
	counters.InvalidFields++
	return ""
}

func tool(raw json.RawMessage) string {
	value, ok := text(raw, 256)
	if !ok {
		return "unknown"
	}
	switch value {
	case "Read", "ReadFile", "read_file", "read_file_v2":
		return "read"
	case "Write", "Edit", "EditFile", "write_file", "edit_file", "StrReplace", "str_replace":
		return "edit"
	case "Shell", "Bash", "run_terminal_cmd":
		return "shell"
	case "MCP":
		return "mcp"
	case "Task":
		return "task"
	case "Delete", "DeleteFile", "delete_file":
		return "delete"
	case "Glob", "Grep", "Search":
		return "search"
	}
	if len(value) > 4 && value[:4] == "MCP:" {
		return "mcp"
	}
	return "unknown"
}

func countDropped(key string, counters *Counters) {
	switch key {
	case "contents", "content", "prompt", "command", "description", "tasks", "old_string", "new_string", "tool_output", "result_json", "user_email", "email", "reasoning", "reason", "transcript_path", "subagent_type":
		counters.SensitiveFields++
	default:
		counters.UnknownFields++
	}
}

// Only one raw field is retained at a time. Unknown field names never leave the
// parser. Field count/key length bounds also bound duplicate-detection memory.
func fields(data []byte, visit func(string, json.RawMessage)) bool {
	d := json.NewDecoder(bytes.NewReader(data))
	first, err := d.Token()
	if err != nil || first != json.Delim('{') {
		return false
	}
	seen := make(map[string]bool)
	for d.More() {
		key, err := d.Token()
		if err != nil {
			return false
		}
		name, ok := key.(string)
		if !ok || len(name) > 128 || len(seen) >= maxFields || seen[name] {
			return false
		}
		seen[name] = true
		var raw json.RawMessage
		if d.Decode(&raw) != nil {
			return false
		}
		visit(name, raw)
	}
	_, err = d.Token()
	return err == nil
}

// Check nesting before the standard decoder allocates token/stack state.
func boundedDepth(data []byte) bool {
	depth := 0
	quoted, escaped := false, false
	for _, c := range data {
		if quoted {
			if escaped {
				escaped = false
			} else if c == '\\' {
				escaped = true
			} else if c == '"' {
				quoted = false
			}
			continue
		}
		switch c {
		case '"':
			quoted = true
		case '{', '[':
			depth++
			if depth > maxDepth {
				return false
			}
		case '}', ']':
			depth--
		}
	}
	return true
}
