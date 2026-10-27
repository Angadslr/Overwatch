package spool

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"overwatch/helper/internal/input"
)

func digest(value string) string {
	h := sha256.Sum256([]byte(value))
	return hex.EncodeToString(h[:])
}

// Only the trusted launcher supplies this ID; raw hook fields cannot create it.
func SelfCheck(checkID string) input.Result {
	if !uuidID.MatchString(checkID) {
		return input.Result{Counters: input.Counters{Gap: "identity-unavailable"}}
	}
	return input.Result{Counters: input.Counters{Gap: "self-check", CheckID: checkID}}
}

func validPolicy(config Config) bool {
	if config.PrivacyVersion != 1 || len(config.AllowedPathHashes) > 12 || !hashID.MatchString(config.PolicyID) {
		return false
	}
	previous := ""
	for _, hash := range config.AllowedPathHashes {
		if !hashID.MatchString(hash) || hash <= previous {
			return false
		}
		previous = hash
	}
	return config.PolicyID == digest(strings.Join(append([]string{"privacy-v1", config.SourceRootHash}, config.AllowedPathHashes...), "\x00"))
}

func readConfig(path string) (Config, error) {
	var config Config
	canonical, err := filepath.EvalSymlinks(path)
	if err != nil || !filepath.IsAbs(path) || canonical != path {
		return config, errors.New("unsafe-spool-root")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || !private(info) {
		return config, errors.New("unsafe-spool-root")
	}
	root, err := os.OpenRoot(path)
	if err != nil {
		return config, err
	}
	defer root.Close()
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(info, opened) {
		return config, errors.New("spool-root-changed")
	}
	data, err := secureRead(root, "publisher.json", 4096)
	if err != nil {
		return config, err
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(&config) != nil {
		return config, errors.New("invalid-publisher-config")
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return config, errors.New("invalid-publisher-config")
	}
	return config, nil
}

// Project applies the extension's compiled fixture policy before a path hash
// enters projected metadata. It never reads file contents or retains paths.
func Project(path string, reader io.Reader, hook string) input.Result {
	config, err := readConfig(path)
	available := err == nil && validPolicy(config)
	result := input.ProjectWithPrivacy(reader, hook, func(value string, roots []string) (string, string) {
		if !available {
			return "", "policy-unavailable"
		}
		hash := digest("path-hint\x00" + value)
		i := sort.SearchStrings(config.AllowedPathHashes, hash)
		if i == len(config.AllowedPathHashes) || config.AllowedPathHashes[i] != hash {
			return "", "excluded-path"
		}
		for _, sourceRoot := range roots {
			if digest("workspace-root\x00"+sourceRoot) != config.SourceRootHash {
				continue
			}
			canonicalRoot, rootErr := filepath.EvalSymlinks(sourceRoot)
			if rootErr != nil || !filepath.IsAbs(sourceRoot) || canonicalRoot != sourceRoot {
				continue
			}
			candidate := value
			if !filepath.IsAbs(candidate) {
				candidate = filepath.Join(sourceRoot, candidate)
			}
			if filepath.Dir(candidate) != sourceRoot || filepath.Clean(candidate) != candidate {
				continue
			}
			info, statErr := os.Lstat(candidate)
			if os.IsNotExist(statErr) {
				return hash, ""
			}
			if statErr == nil && info.Mode().IsRegular() {
				return hash, ""
			}
		}
		return "", "path-unresolved"
	})
	if available && result.Metadata != nil && result.Metadata.PathHash != "" {
		result.Metadata.PolicyID = config.PolicyID
	}
	return result
}

func enforcePublicationPolicy(config Config, result input.Result) input.Result {
	if result.Metadata == nil || result.Metadata.PathHash == "" {
		return result
	}
	m := *result.Metadata
	i := sort.SearchStrings(config.AllowedPathHashes, m.PathHash)
	if !validPolicy(config) || m.PolicyID != config.PolicyID || i == len(config.AllowedPathHashes) || config.AllowedPathHashes[i] != m.PathHash {
		m.PathHash = ""
		m.PolicyID = ""
		result.Metadata = &m
		result.Counters.Privacy = "policy-unavailable"
	}
	return result
}
