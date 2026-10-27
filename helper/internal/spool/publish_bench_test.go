package spool

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// This microbenchmark isolates queue admission plus durable publication. It is
// separate from the fresh-process and installed-editor measurements.
func BenchmarkPublicationQueueSize(b *testing.B) {
	for _, queued := range []int{0, 512, 2048} {
		b.Run(fmt.Sprintf("queued-%d", queued), func(b *testing.B) {
			path, err := filepath.EvalSymlinks(b.TempDir())
			if err != nil {
				b.Fatal(err)
			}
			if err := os.Chmod(path, 0700); err != nil {
				b.Fatal(err)
			}
			root, err := os.OpenRoot(path)
			if err != nil {
				b.Fatal(err)
			}
			defer root.Close()
			for i := 0; i < queued; i++ {
				name := fmt.Sprintf("00000000-0000-4000-8000-%012d.json", i)
				if err := os.WriteFile(filepath.Join(path, name), []byte(`{"fixture":true}`), 0600); err != nil {
					b.Fatal(err)
				}
			}
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				id := fmt.Sprintf("10000000-0000-4000-8000-%012d", i)
				if err := Publish(root, id, []byte(`{"fixture":true}`)); err != nil {
					b.Fatal(err)
				}
				if err := root.Remove(id + ".json"); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func BenchmarkDurabilityStages(b *testing.B) {
	b.Run("file-data-sync", func(b *testing.B) {
		path := filepath.Join(b.TempDir(), "data")
		file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
		if err != nil {
			b.Fatal(err)
		}
		defer file.Close()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			if _, err := file.WriteAt([]byte{byte(i)}, 0); err != nil {
				b.Fatal(err)
			}
			if err := file.Sync(); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("directory-entry-sync", func(b *testing.B) {
		path := b.TempDir()
		folder, err := os.Open(path)
		if err != nil {
			b.Fatal(err)
		}
		defer folder.Close()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			name := filepath.Join(path, "entry")
			if err := os.WriteFile(name, []byte{byte(i)}, 0600); err != nil {
				b.Fatal(err)
			}
			if err := os.Remove(name); err != nil {
				b.Fatal(err)
			}
			if err := folder.Sync(); err != nil {
				b.Fatal(err)
			}
		}
	})
}
