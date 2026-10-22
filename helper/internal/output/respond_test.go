package output

import (
	"bytes"
	"io"
	"testing"
)

func TestEveryResponse(t *testing.T) {
	permissions := map[string]bool{"preToolUse": true, "beforeReadFile": true, "beforeShellExecution": true, "beforeMCPExecution": true, "subagentStart": true}
	for _, hook := range append(Hooks(), "unknown") {
		var b bytes.Buffer
		if err := Respond(&b, hook); err != nil {
			t.Fatal(err)
		}
		want := "{}\n"
		if permissions[hook] {
			want = "{\"permission\":\"allow\"}\n"
		}
		if b.String() != want {
			t.Fatalf("%s: %q", hook, b.String())
		}
	}
}

type shortWriter struct{ calls int }

func (w *shortWriter) Write(p []byte) (int, error) { w.calls++; return len(p) - 1, nil }
func TestPartialResponseIsNotRetried(t *testing.T) {
	w := &shortWriter{}
	if err := Respond(w, "preToolUse"); err != io.ErrShortWrite || w.calls != 1 {
		t.Fatalf("%v, calls %d", err, w.calls)
	}
}
