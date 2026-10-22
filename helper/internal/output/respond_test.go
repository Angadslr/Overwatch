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

func TestKnownHooksCannotBeMutatedByCaller(t *testing.T) {
	hooks := Hooks()
	if len(hooks) != 14 {
		t.Fatal("response profile changed without updating qualification")
	}
	for _, hook := range hooks {
		if !Known(hook) {
			t.Fatalf("missing handler: %s", hook)
		}
	}
	hooks[0] = "invented"
	if Known("invented") || Known("") || !Known("sessionStart") {
		t.Fatal("mutable or overly broad hook allowlist")
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
