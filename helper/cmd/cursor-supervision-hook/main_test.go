package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"overwatch/helper/internal/input"
	"overwatch/helper/internal/output"
)

var helperBinary string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "overwatch-go-hook-")
	if err != nil {
		os.Exit(1)
	}
	helperBinary = filepath.Join(dir, "helper with spaces")
	cmd := exec.Command(filepath.Join(runtime.GOROOT(), "bin", "go"), "build", "-o", helperBinary, ".")
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if cmd.Run() != nil {
		os.RemoveAll(dir)
		os.Exit(1)
	}
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

func invoke(t *testing.T, hook string, data []byte) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, helperBinary, hook)
	cmd.Stdin = bytes.NewReader(data)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("helper exit: %v stderr=%q", err, stderr.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("stderr was not empty: %q", stderr.String())
	}
	var expected bytes.Buffer
	if err := output.Respond(&expected, hook); err != nil {
		t.Fatal(err)
	}
	if stdout.String() != expected.String() {
		t.Fatalf("response mismatch: %q", stdout.String())
	}
	return stdout.String()
}

func TestEveryHookAsRealProcess(t *testing.T) {
	// Include the response-only sessionEnd compatibility case, even though it
	// must not be advertised as a qualified installed hook.
	oversized := bytes.Repeat([]byte("x"), input.MaxInputBytes+1)
	for _, hook := range output.Hooks() {
		t.Run(hook, func(t *testing.T) {
			valid, _ := json.Marshal(map[string]any{"hook_event_name": hook, "prompt": "FAKE_SECRET_MARKER", "tool_output": "FAKE_SECRET_MARKER", "user_email": "fake@example.invalid"})
			for _, data := range [][]byte{valid, []byte(`{broken FAKE_SECRET_MARKER`), []byte(`[]`), {0xff}, oversized} {
				got := invoke(t, hook, data)
				if strings.Contains(got, "FAKE_SECRET_MARKER") {
					t.Fatal("response leaked telemetry")
				}
			}
		})
	}
}

func TestResponsePrecedesInputAndProcessBudget(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, helperBinary, "beforeReadFile")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer stdin.Close()
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	start := time.Now()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil || line != "{\"permission\":\"allow\"}\n" {
		t.Fatalf("missing immediate response: %q %v", line, err)
	}
	if time.Since(start) >= invocationBudget {
		t.Fatal("response waited for input deadline")
	}
	// Keep stdin open forever; process termination must not require EOF.
	if err := cmd.Wait(); err != nil {
		t.Fatal(err)
	}
	if time.Since(start) > 4*time.Second || stderr.Len() != 0 {
		t.Fatal("process budget or stderr invariant failed")
	}
}

func TestConsumerErrorsAndPanicsCannotChangeResponse(t *testing.T) {
	for name, consume := range map[string]func(input.Result) error{
		"error": func(input.Result) error { return errors.New("FAKE_SECRET_MARKER") },
		"panic": func(input.Result) error { panic("FAKE_SECRET_MARKER") },
	} {
		t.Run(name, func(t *testing.T) {
			var stdout bytes.Buffer
			got := run([]string{"preToolUse"}, strings.NewReader(`{"hook_event_name":"preToolUse","prompt":"FAKE_SECRET_MARKER"}`), &stdout, consume)
			want := "telemetry-consumer-failed"
			if name == "panic" {
				want = "telemetry-panic"
			}
			b, _ := json.Marshal(got)
			if got.Counters.Gap != want || stdout.String() != "{\"permission\":\"allow\"}\n" || bytes.Contains(b, []byte("FAKE_SECRET_MARKER")) {
				t.Fatalf("failure escaped boundary: %s", b)
			}
		})
	}
}

func TestConsumerReceivesOnlyProjectedMetadata(t *testing.T) {
	var stdout bytes.Buffer
	called := false
	got := run([]string{"postToolUseFailure"}, strings.NewReader(`{"hook_event_name":"postToolUseFailure","failure_type":"error","tool_output":"FAKE_SECRET_MARKER"}`), &stdout, func(result input.Result) error {
		called = true
		b, err := json.Marshal(result)
		if err != nil || bytes.Contains(b, []byte("FAKE_SECRET_MARKER")) {
			return errors.New("unsafe projection")
		}
		return nil
	})
	if !called || got.Counters.Gap != "" || got.Metadata.FailureType != "error" || stdout.String() != "{}\n" {
		t.Fatalf("consumer contract failed: %+v", got)
	}
}

func TestInvalidLauncherDoesNotReadInput(t *testing.T) {
	for _, args := range [][]string{nil, {"unknown"}, {"preToolUse", "FAKE_SECRET_MARKER"}} {
		var stdout bytes.Buffer
		result := run(args, panicReader{}, &stdout, nil)
		if result.Counters.Gap != "invalid-launcher" {
			t.Fatal(result)
		}
	}
	invoke(t, "unknown", nil)
}

type panicReader struct{}

func (panicReader) Read([]byte) (int, error) { panic("must not read invalid launcher input") }

func TestReadPanicIsContained(t *testing.T) {
	var stdout bytes.Buffer
	got := run([]string{"preToolUse"}, panicReader{}, &stdout, nil)
	if got.Counters.Gap != "telemetry-panic" || stdout.String() != "{\"permission\":\"allow\"}\n" {
		t.Fatal(got)
	}
}

func TestConsumerTimeout(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	var stdout bytes.Buffer
	got := run([]string{"stop"}, strings.NewReader(`{"hook_event_name":"stop"}`), &stdout, func(input.Result) error { <-release; return nil })
	if got.Counters.Gap != "input-or-consumer-timeout" || stdout.String() != "{}\n" {
		t.Fatal(got)
	}
}

func TestResponseWriteFailureSkipsTelemetry(t *testing.T) {
	got := run([]string{"preToolUse"}, panicReader{}, failingWriter{}, nil)
	if got.Counters.Gap != "response-write-failed" {
		t.Fatal(got)
	}
}

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }
