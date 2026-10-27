package spool

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// RecordFailure preserves one coarse, content-free loss marker. It deliberately
// makes no claim about the number of lost events. Disabled cached hooks cannot
// write it, and an existing file is never replaced or followed.
func RecordFailure(path, category string) {
	RecordFailureForCollector(path, category, "")
}
func RecordFailureForCollector(path, category, expected string) {
	if category != "publication-failed" && category != "deadline-exceeded" {
		return
	}
	config, err := readConfig(path)
	if err != nil || !config.Enabled || config.Version != 1 || !hashID.MatchString(config.SourceRootHash) {
		return
	}
	if (expected != "" && expected != config.CollectorID) || (config.RequireCollectorEpoch && expected == "") {
		return
	}
	before, err := os.Lstat(path)
	if err != nil || !before.IsDir() || !private(before) {
		return
	}
	root, err := os.OpenRoot(path)
	if err != nil {
		return
	}
	defer root.Close()
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(before, opened) {
		return
	}
	writer := root
	if config.RequireCollectorEpoch {
		writer, err = root.OpenRoot(filepath.Join("inbox", config.CollectorID))
		if err != nil {
			return
		}
		defer writer.Close()
	}
	file, err := writer.OpenFile("producer-loss.json", os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return
	}
	defer file.Close()
	value := struct {
		Version    int    `json:"lossVersion"`
		Category   string `json:"category"`
		RecordedAt string `json:"recordedAt"`
	}{1, category, time.Now().UTC().Format("2006-01-02T15:04:05.000Z")}
	bytes, err := json.Marshal(value)
	if err != nil {
		return
	}
	if _, err = file.Write(bytes); err == nil {
		_ = file.Sync()
	}
}
