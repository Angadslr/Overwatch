// This synthetic benchmark client is not bundled or called by the extension.
package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"time"
)

func run() int {
	// Model the response-first hook contract without parsing or recording stdin.
	fmt.Print("{\"permission\":\"allow\"}\n")
	if len(os.Args) != 3 || os.Args[1] != "--connect" || len(os.Args[2]) > 100 {
		return 1
	}
	connection, err := net.DialTimeout("unix", os.Args[2], time.Second)
	if err != nil {
		return 1
	}
	defer connection.Close()
	if err := connection.SetDeadline(time.Now().Add(1500 * time.Millisecond)); err != nil {
		return 1
	}
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return 1
	}
	id[6] = (id[6] & 15) | 64
	id[8] = (id[8] & 63) | 128
	encoded, err := json.Marshal(struct {
		EventID string `json:"eventId"`
	}{hex.EncodeToString(id)})
	if err != nil {
		return 1
	}
	if _, err := io.Copy(connection, bytes.NewReader(append(encoded, '\n'))); err != nil {
		return 1
	}
	response, err := bufio.NewReader(io.LimitReader(connection, 32)).ReadString('\n')
	if err != nil || response != "{\"durable\":true}\n" {
		return 1
	}
	return 0
}

func main() { os.Exit(run()) }
