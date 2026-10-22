package contract

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// Shape parity only: this is not a replacement for the authoritative TS runtime
// validator. Preserve optional zero counts and avoid null required arrays.
func TestNormalizedFixtureRoundTrip(t *testing.T) {
	b, err := os.ReadFile("../../../tests/fixtures/core/event-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var event EventV1
	if err := json.Unmarshal(b, &event); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	var before, after any
	if err := json.Unmarshal(b, &before); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(encoded, &after); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("fixture shape changed: %s", encoded)
	}
}
