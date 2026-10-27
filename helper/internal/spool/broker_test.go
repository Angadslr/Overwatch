package spool

import (
	"bufio"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestBrokerJSONRefusesUnknownAndTrailingValues(t *testing.T) {
	for _, encoded := range []string{`{"version":1,"secret":"FAKE_SECRET"}`, `{"version":1} {}`, `{"version":`, `[]`, `null {}`} {
		var value struct {
			Version int `json:"version"`
		}
		if decodeBrokerJSON([]byte(encoded), &value) {
			t.Fatalf("accepted malformed broker JSON: %q", encoded)
		}
	}
	var value struct {
		Version int `json:"version"`
	}
	if !decodeBrokerJSON([]byte("{\"version\":1}\n"), &value) || value.Version != 1 {
		t.Fatal("valid broker JSON refused")
	}
}

func TestBrokerAcknowledgmentMustMatchExactDurableEvent(t *testing.T) {
	cases := []struct {
		name     string
		change   func(map[string]any)
		suffix   string
		accepted bool
	}{
		{name: "valid", accepted: true},
		{name: "wrong-event", change: func(ack map[string]any) { ack["eventId"] = "00000000-0000-4000-8000-000000000002" }},
		{name: "wrong-digest", change: func(ack map[string]any) { ack["digest"] = strings.Repeat("0", 64) }},
		{name: "not-durable", change: func(ack map[string]any) { ack["durable"] = false }},
		{name: "wrong-version", change: func(ack map[string]any) { ack["brokerVersion"] = 2 }},
		{name: "unknown-field", change: func(ack map[string]any) { ack["secret"] = "FAKE_SECRET" }},
		{name: "second-frame", suffix: "{}\n"},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			parent := os.TempDir()
			if runtime.GOOS == "darwin" {
				parent = "/private/tmp"
			}
			parent, err := filepath.EvalSymlinks(parent)
			if err != nil {
				t.Fatal(err)
			}
			random := make([]byte, 3)
			if _, err = rand.Read(random); err != nil {
				t.Fatal(err)
			}
			directory := filepath.Join(parent, "overwatch-broker-"+hex.EncodeToString(random))
			if err = os.Mkdir(directory, 0700); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { os.RemoveAll(directory) })
			endpoint := &BrokerEndpoint{Version: 1, Path: filepath.Join(directory, "s"), Token: strings.Repeat("a", 64), OwnerID: "00000000-0000-4000-8000-000000000001"}
			listener, err := net.Listen("unix", endpoint.Path)
			if err != nil {
				if errors.Is(err, syscall.EPERM) || errors.Is(err, syscall.EACCES) {
					t.Skip("native Unix sockets unavailable")
				}
				t.Fatal(err)
			}
			defer listener.Close()
			if err = os.Chmod(endpoint.Path, 0600); err != nil {
				t.Fatal(err)
			}
			info, err := os.Lstat(endpoint.Path)
			if err != nil {
				t.Fatal(err)
			}
			stat := info.Sys().(*syscall.Stat_t)
			tokenHash := sha256.Sum256([]byte(endpoint.Token))
			proof, err := json.Marshal(map[string]any{"brokerVersion": 1, "ownerId": endpoint.OwnerID, "tokenDigest": hex.EncodeToString(tokenHash[:]), "socketDev": uint64(stat.Dev), "socketIno": stat.Ino})
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(filepath.Join(directory, "owner.json"), proof, 0600); err != nil {
				t.Fatal(err)
			}
			envelope := Envelope{Version: 1, EventID: "00000000-0000-4000-8000-000000000003", CollectorID: "collector", EnvironmentID: "local", WorkspaceID: "workspace"}
			encoded, err := json.Marshal(envelope)
			if err != nil {
				t.Fatal(err)
			}
			digest := sha256.Sum256(encoded)
			done := make(chan struct{})
			go func() {
				defer close(done)
				connection, err := listener.Accept()
				if err != nil {
					return
				}
				defer connection.Close()
				connection.SetDeadline(time.Now().Add(time.Second))
				if _, err = bufio.NewReader(connection).ReadBytes('\n'); err != nil {
					return
				}
				ack := map[string]any{"brokerVersion": 1, "eventId": envelope.EventID, "digest": hex.EncodeToString(digest[:]), "durable": true}
				if item.change != nil {
					item.change(ack)
				}
				response, _ := json.Marshal(ack)
				connection.Write(append(response, []byte("\n"+item.suffix)...))
			}()
			actual := tryBroker(endpoint, envelope, encoded)
			listener.Close()
			<-done
			if actual != item.accepted {
				t.Fatalf("acknowledgment accepted=%v, want %v", actual, item.accepted)
			}
		})
	}
}
