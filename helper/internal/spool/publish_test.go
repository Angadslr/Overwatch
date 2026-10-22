package spool

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"overwatch/helper/internal/input"
)

func setup(t *testing.T) (string, *os.Root) {
	t.Helper()
	path, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(path, "inbox"), 0700); err != nil {
		t.Fatal(err)
	}
	config := Config{Version: 1, CollectorID: "collector", EnvironmentID: "local", WorkspaceID: "workspace", SourceRootHash: strings.Repeat("a", 64), Enabled: true}
	b, _ := json.Marshal(config)
	if err := os.WriteFile(filepath.Join(path, "publisher.json"), b, 0600); err != nil {
		t.Fatal(err)
	}
	r, err := os.OpenRoot(filepath.Join(path, "inbox"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Close() })
	return path, r
}
func TestConcurrentAtomicPublicationAndRetry(t *testing.T) {
	_, root := setup(t)
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := fmt.Sprintf("00000000-0000-4000-8000-%012d", i)
			b := []byte(fmt.Sprintf(`{"eventId":%q}`, id))
			for retry := 0; retry < 2; retry++ {
				if err := Publish(root, id, b); err != nil {
					t.Error(err)
				}
			}
		}(i)
	}
	wg.Wait()
	d, err := root.Open(".")
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	entries, err := d.Readdir(-1)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 32 {
		t.Fatalf("got %d files", len(entries))
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			t.Fatal("temporary file leaked")
		}
		b, err := root.ReadFile(entry.Name())
		if err != nil || !json.Valid(b) {
			t.Fatal("partial publication")
		}
	}
	id := "00000000-0000-4000-8000-000000000000"
	if Publish(root, id, []byte(`{}`)) == nil {
		t.Fatal("conflicting identity overwritten")
	}
}
func TestConfiguredPrivacyAndScope(t *testing.T) {
	path, _ := setup(t)
	m := &input.Metadata{Version: 1, EventID: "00000000-0000-4000-8000-000000000000", SourceEvent: "beforeReadFile", SourceVersion: "3.26.16", WorkspaceRootHashes: []string{strings.Repeat("a", 64)}, Tool: "read"}
	result := input.Result{Metadata: m}
	if err := PublishResult(path, result); err != nil {
		t.Fatal(err)
	}
	if err := PublishResult(path, result); err != nil {
		t.Fatal(err)
	}
	m.WorkspaceRootHashes = []string{strings.Repeat("b", 64)}
	if PublishResult(path, result) == nil {
		t.Fatal("unrelated workspace accepted")
	}
	if err := os.Chmod(filepath.Join(path, "publisher.json"), 0644); err != nil {
		t.Fatal(err)
	}
	if PublishResult(path, result) == nil {
		t.Fatal("public config accepted")
	}
}
func TestBoundsAndSubstitution(t *testing.T) {
	path, root := setup(t)
	id := "00000000-0000-4000-8000-000000000000"
	if Publish(root, id, bytes.Repeat([]byte("x"), input.MaxProjectionBytes+1)) == nil {
		t.Fatal("oversize accepted")
	}
	outside := filepath.Join(t.TempDir(), "unrelated")
	if err := os.WriteFile(outside, []byte("FAKE_SECRET_MARKER"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(path, "inbox", id+".json")); err != nil {
		t.Fatal(err)
	}
	if Publish(root, id, []byte(`{}`)) == nil {
		t.Fatal("symlink substituted")
	}
	b, _ := os.ReadFile(outside)
	if string(b) != "FAKE_SECRET_MARKER" {
		t.Fatal("unrelated target changed")
	}
	if err := os.Remove(filepath.Join(path, "inbox", id+".json")); err != nil {
		t.Fatal(err)
	}
	file, err := root.OpenFile("fill", os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(MaxBytes); err != nil {
		t.Fatal(err)
	}
	file.Close()
	if Publish(root, id, []byte(`{}`)) == nil {
		t.Fatal("full spool accepted")
	}
}
