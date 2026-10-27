package spool

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"syscall"
	"time"
)

type BrokerEndpoint struct {
	Version int    `json:"brokerVersion"`
	Path    string `json:"path"`
	Token   string `json:"token"`
	OwnerID string `json:"ownerId"`
}

var brokerDirectory = regexp.MustCompile(`^overwatch-broker-[A-Za-z0-9]{6}$`)

func decodeBrokerJSON(encoded []byte, target any) bool {
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	if decoder.Decode(target) != nil {
		return false
	}
	return decoder.Decode(new(any)) == io.EOF
}

// The short-lived hook never waits indefinitely for a collector. A missing or
// uncertain acknowledgment returns to publication with the same encoded event.
func tryBroker(endpoint *BrokerEndpoint, envelope Envelope, encoded []byte) bool {
	if endpoint == nil || endpoint.Version != 1 || !hashID.MatchString(endpoint.Token) || !uuidID.MatchString(endpoint.OwnerID) || !filepath.IsAbs(endpoint.Path) || len(endpoint.Path) > 100 || filepath.Base(endpoint.Path) != "s" {
		return false
	}
	parent := filepath.Dir(endpoint.Path)
	canonical, err := filepath.EvalSymlinks(parent)
	if err != nil || canonical != parent || !brokerDirectory.MatchString(filepath.Base(parent)) {
		return false
	}
	before, err := os.Lstat(parent)
	if err != nil || !before.IsDir() || !private(before) {
		return false
	}
	root, err := os.OpenRoot(parent)
	if err != nil {
		return false
	}
	defer root.Close()
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(before, opened) {
		return false
	}
	proofBytes, err := secureRead(root, "owner.json", 2048)
	if err != nil {
		return false
	}
	var proof struct {
		Version     int    `json:"brokerVersion"`
		OwnerID     string `json:"ownerId"`
		TokenDigest string `json:"tokenDigest"`
		SocketDev   uint64 `json:"socketDev"`
		SocketIno   uint64 `json:"socketIno"`
	}
	if !decodeBrokerJSON(proofBytes, &proof) {
		return false
	}
	tokenHash := sha256.Sum256([]byte(endpoint.Token))
	if proof.Version != 1 || proof.OwnerID != endpoint.OwnerID || proof.TokenDigest != hex.EncodeToString(tokenHash[:]) {
		return false
	}
	socket, err := root.Lstat("s")
	if err != nil || socket.Mode()&os.ModeSocket == 0 || !private(socket) {
		return false
	}
	stat, ok := socket.Sys().(*syscall.Stat_t)
	if !ok || proof.SocketDev != uint64(stat.Dev) || proof.SocketIno != stat.Ino {
		return false
	}
	deadline := time.Now().Add(250 * time.Millisecond)
	connection, err := (&net.Dialer{Deadline: deadline}).Dial("unix", endpoint.Path)
	if err != nil {
		return false
	}
	defer connection.Close()
	if err := connection.SetDeadline(deadline); err != nil {
		return false
	}
	current, err := root.Lstat("s")
	if err != nil || !os.SameFile(socket, current) {
		return false
	}
	request, err := json.Marshal(struct {
		Version  int             `json:"brokerVersion"`
		Token    string          `json:"token"`
		Envelope json.RawMessage `json:"envelope"`
	}{1, endpoint.Token, encoded})
	if err != nil {
		return false
	}
	request = append(request, '\n')
	for len(request) > 0 {
		written, err := connection.Write(request)
		if err != nil || written == 0 {
			return false
		}
		request = request[written:]
	}
	reader := bufio.NewReader(io.LimitReader(connection, 513))
	response, err := reader.ReadBytes('\n')
	if err != nil || len(response) > 512 {
		return false
	}
	if _, err := reader.ReadByte(); err != io.EOF {
		return false
	}
	var acknowledgment struct {
		Version int    `json:"brokerVersion"`
		EventID string `json:"eventId"`
		Digest  string `json:"digest"`
		Durable bool   `json:"durable"`
	}
	if !decodeBrokerJSON(response, &acknowledgment) {
		return false
	}
	digest := sha256.Sum256(encoded)
	return acknowledgment.Version == 1 && acknowledgment.Durable && acknowledgment.EventID == envelope.EventID && acknowledgment.Digest == hex.EncodeToString(digest[:])
}
