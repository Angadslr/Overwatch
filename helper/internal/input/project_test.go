package input

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strings"
	"testing"
	"time"
)

func projectJSON(t *testing.T, value any) Result {
	t.Helper()
	b, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return Project(bytes.NewReader(b), "postToolUseFailure")
}

func TestProjectionPrivacyAndEvidence(t *testing.T) {
	secret := "FAKE_SECRET_MARKER_angad@example.invalid"
	payload := map[string]any{
		"hook_event_name": "postToolUseFailure", "cursor_version": "3.26.16",
		"conversation_id": secret, "generation_id": secret, "session_id": secret,
		"tool_use_id": secret, "tool_call_id": secret, "subagent_id": secret,
		"parent_conversation_id": secret, "file_path": "/private/" + secret,
		"tool_name": "MCP:" + secret, "duration": 0, "status": "error",
		"failure_type": "permission_denied", "is_interrupt": false,
		"workspace_roots": []string{"/private/" + secret}, "cwd": secret,
		"tool_input": map[string]any{"command": secret, "contents": secret, "prompt": secret, "unknown": secret},
	}
	for _, key := range []string{"contents", "prompt", "command", "tool_output", "result_json", "user_email", "reasoning", "unknown", secret} {
		payload[key] = secret
	}
	result := projectJSON(t, payload)
	if result.Metadata == nil || result.Counters.Gap != "" {
		t.Fatalf("missing projection: %+v", result.Counters)
	}
	b, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{secret, "/private/", "permission_denied\"" + secret, "tool_input", "tool_output"} {
		if bytes.Contains(b, []byte(forbidden)) {
			t.Fatalf("privacy boundary leaked forbidden value")
		}
	}
	m := result.Metadata
	if m.Tool != "mcp" || m.Status != "error" || m.FailureType != "permission_denied" || m.DurationMS == nil || *m.DurationMS != 0 || m.Interrupted == nil || *m.Interrupted {
		t.Fatalf("lost safe source metadata: %s", b)
	}
	if m.ConversationID != m.ParentConversationID || m.ConversationID == m.GenerationID || len(m.PathHash) != 64 {
		t.Fatal("identity domains are inconsistent")
	}
	if result.Counters.UnknownFields != 3 || result.Counters.SensitiveFields < 9 {
		t.Fatalf("incorrect counters: %+v", result.Counters)
	}
	if _, err := time.Parse("2006-01-02T15:04:05.000Z", m.ReceivedAt); err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(m.EventID) {
		t.Fatal("invalid UUID v4")
	}
	other := projectJSON(t, payload)
	if other.Metadata.EventID == m.EventID || other.Metadata.CallID != m.CallID {
		t.Fatal("event identity must be unique and source hints stable")
	}
}

func TestInvalidInputsAreCoverageGaps(t *testing.T) {
	cases := []struct{ name, input, gap string }{
		{"empty", "", "invalid-json"}, {"malformed", "{", "invalid-json"},
		{"array", "[]", "invalid-object"}, {"null", "null", "invalid-object"},
		{"trailing", `{} {}`, "invalid-json"},
		{"invalid utf8", string([]byte{0xff}), "invalid-utf8"},
		{"missing hook", `{}`, "hook-mismatch"},
		{"wrong hook", `{"hook_event_name":"stop"}`, "hook-mismatch"},
		{"duplicate hook", `{"hook_event_name":"postToolUseFailure","hook_event_name":"postToolUseFailure"}`, "invalid-object"},
		{"escaped duplicate", `{"hook_event_name":"postToolUseFailure","hook_event_nam\u0065":"postToolUseFailure"}`, "invalid-object"},
		{"deep", `{"extra":` + strings.Repeat("[", 64) + `0` + strings.Repeat("]", 64) + `}`, "input-too-deep"},
		{"long key", `{"` + strings.Repeat("x", 129) + `":0}`, "invalid-object"},
		{"duplicate nested", `{"hook_event_name":"postToolUseFailure","tool_input":{"path":"a","path":"b"}}`, "invalid-tool-input"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Project(strings.NewReader(tc.input), "postToolUseFailure")
			if got.Metadata != nil || got.Counters.Gap != tc.gap {
				t.Fatalf("got %+v, want %s", got, tc.gap)
			}
		})
	}
	if got := Project(strings.NewReader(`{}`), "invented"); got.Counters.Gap != "unsupported-hook" {
		t.Fatal(got)
	}
}

func TestFieldBoundsAndUnknownValues(t *testing.T) {
	payload := map[string]any{"hook_event_name": "postToolUseFailure", "conversation_id": strings.Repeat("x", 256), "file_path": strings.Repeat("x", 4096)}
	good := projectJSON(t, payload)
	if good.Metadata.ConversationID == "" || good.Metadata.PathHash == "" {
		t.Fatal("exact bounds rejected")
	}
	for key, value := range map[string]any{
		"conversation_id": strings.Repeat("x", 257), "generation_id": []string{"secret"},
		"session_id": nil, "tool_use_id": true, "file_path": strings.Repeat("x", 4097),
		"cursor_version": "3.26.16-secret", "tool_name": "FAKE_SECRET_MARKER", "duration": -1,
		"status": "FAKE_SECRET_MARKER", "failure_type": "FAKE_SECRET_MARKER", "is_interrupt": "false",
	} {
		payload[key] = value
	}
	got := projectJSON(t, payload)
	if got.Metadata == nil || got.Counters.Gap != "" || got.Counters.InvalidFields != 10 {
		t.Fatalf("invalid field handling: %+v", got)
	}
	b, _ := json.Marshal(got)
	if bytes.Contains(b, []byte("FAKE_SECRET_MARKER")) || got.Metadata.Tool != "unknown" {
		t.Fatal("unrecognized values leaked")
	}
	for _, value := range []any{nil, "7", 86400001, 1e100} {
		payload["duration"] = value
		if got := projectJSON(t, payload); got.Metadata.DurationMS != nil {
			t.Fatal("invalid duration retained")
		}
	}
	payload["duration"] = 86400000
	if got := projectJSON(t, payload); got.Metadata.DurationMS == nil {
		t.Fatal("exact duration cap rejected")
	}
}

func TestMalformedUnicodeCannotAliasSourceIdentities(t *testing.T) {
	for _, value := range []string{`"\ud800"`, `"\ud801"`, `"\udc00"`, `"\ufffd"`} {
		got := Project(strings.NewReader(`{"hook_event_name":"preToolUse","conversation_id":`+value+`}`), "preToolUse")
		if got.Metadata == nil || got.Metadata.ConversationID != "" || got.Counters.InvalidFields != 1 {
			t.Fatal("lossy Unicode became an identity")
		}
	}
	got := Project(strings.NewReader(`{"hook_event_name":"preToolUse","conversation_id":"\ud83d\ude00"}`), "preToolUse")
	if got.Metadata == nil || got.Metadata.ConversationID == "" {
		t.Fatal("valid surrogate pair rejected")
	}
}

func TestNestedPathHintsAndConflictingAliases(t *testing.T) {
	for _, args := range []string{`{"file_path":"/fixture/read.txt"}`, `{"path":"/fixture/read.txt"}`, `{"target_file":"/fixture/read.txt"}`} {
		input := `{"hook_event_name":"preToolUse","file_path":"/fixture/read.txt","tool_input":` + args + `}`
		got := Project(strings.NewReader(input), "preToolUse")
		if got.Metadata == nil || len(got.Metadata.PathHash) != 64 {
			t.Fatal("matching path hint omitted")
		}
	}
	got := Project(strings.NewReader(`{"hook_event_name":"preToolUse","file_path":"/fixture/read.txt","tool_input":{"path":"/fixture/other.txt"}}`), "preToolUse")
	if got.Metadata == nil || got.Metadata.PathHash != "" || got.Counters.InvalidFields != 1 {
		t.Fatal("conflicting aliases were assigned precedence")
	}
	b, _ := json.Marshal(got)
	if bytes.Contains(b, []byte("/fixture")) {
		t.Fatal("raw path leaked")
	}
}

func TestQualifiedReadEditToolVariants(t *testing.T) {
	for category, variants := range map[string][]string{
		"read": {"Read", "ReadFile", "read_file", "read_file_v2"},
		"edit": {"Write", "Edit", "EditFile", "write_file", "edit_file", "StrReplace", "str_replace"},
	} {
		for _, name := range variants {
			b, _ := json.Marshal(map[string]any{"hook_event_name": "preToolUse", "tool_name": name, "tool_input": map[string]any{"file_path": "/fixture/read.txt", "contents": "FAKE_SECRET_MARKER"}})
			got := Project(bytes.NewReader(b), "preToolUse")
			if got.Metadata == nil || got.Metadata.Tool != category || got.Metadata.PathHash == "" {
				t.Fatalf("variant %s was not projected", name)
			}
			encoded, _ := json.Marshal(got)
			if bytes.Contains(encoded, []byte("FAKE_SECRET_MARKER")) || bytes.Contains(encoded, []byte("/fixture")) {
				t.Fatal("variant projection leaked content")
			}
		}
	}
}

type countingReader struct{ remaining, read int }

func (r *countingReader) Read(p []byte) (int, error) {
	if r.remaining == 0 {
		return 0, io.EOF
	}
	n := min(len(p), r.remaining)
	for i := range p[:n] {
		p[i] = ' '
	}
	r.remaining -= n
	r.read += n
	return n, nil
}

type brokenReader struct{}

func (brokenReader) Read([]byte) (int, error) { return 0, errors.New("FAKE_SECRET_MARKER") }

func TestInputAndIdentityBudgets(t *testing.T) {
	r := &countingReader{remaining: MaxInputBytes * 2}
	if got := Project(r, "preToolUse"); got.Counters.Gap != "input-too-large" || r.read != MaxInputBytes+1 {
		t.Fatalf("input not bounded: %d %+v", r.read, got)
	}
	exact := `{"hook_event_name":"preToolUse","contents":"` + strings.Repeat("x", MaxInputBytes-len(`{"hook_event_name":"preToolUse","contents":""}`)) + `"}`
	if len(exact) != MaxInputBytes {
		t.Fatal("bad test fixture")
	}
	if got := Project(strings.NewReader(exact), "preToolUse"); got.Metadata == nil {
		t.Fatalf("exact cap rejected: %+v", got)
	}
	if got := Project(brokenReader{}, "preToolUse"); got.Counters.Gap != "input-read-failed" {
		t.Fatal(got)
	}
	if got := ProjectWithEntropy(strings.NewReader(`{"hook_event_name":"preToolUse"}`), "preToolUse", brokenReader{}); got.Counters.Gap != "identity-unavailable" {
		t.Fatal(got)
	}
	var fields []string
	for i := 0; i < maxFields+1; i++ {
		fields = append(fields, fmtField(i))
	}
	if got := Project(strings.NewReader("{"+strings.Join(fields, ",")+"}"), "preToolUse"); got.Counters.Gap != "invalid-object" {
		t.Fatal(got)
	}
}

func fmtField(i int) string {
	b, _ := json.Marshal(time.Unix(int64(i), 0).String())
	return string(b) + ":0"
}

func FuzzProject(f *testing.F) {
	for _, seed := range []string{`{"hook_event_name":"preToolUse"}`, `{"hook_event_name":"preToolUse","extra":{"prompt":"FAKE_SECRET_MARKER"}}`, `null`, `{"duration":1e999}`} {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 100000 {
			t.Skip()
		}
		result := Project(bytes.NewReader(data), "preToolUse")
		b, err := json.Marshal(result)
		if err != nil || len(b) > MaxProjectionBytes || bytes.Contains(b, []byte("FAKE_SECRET_MARKER")) {
			t.Fatal("projection invariant failed")
		}
	})
}
