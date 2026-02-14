package integration

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

type Backend struct {
	Name    string
	BaseURL string
}

var backends []Backend

func projectRoot() string {
	abs, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		panic(err)
	}
	return abs
}

func TestMain(m *testing.M) {
	root := projectRoot()

	// Build Rust backend upfront
	build := exec.Command("cargo", "build", "-p", "demo-backend-rust")
	build.Dir = root
	build.Stdout = os.Stderr
	build.Stderr = os.Stderr
	if err := build.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "cargo build failed: %v\n", err)
		os.Exit(1)
	}

	// Build TS packages for Node demo
	for _, pkg := range []string{"injector", "server", "adapter-bun", "adapter-node"} {
		pkgBuild := exec.Command("bun", "run", "--cwd", filepath.Join("packages", pkg), "build")
		pkgBuild.Dir = root
		pkgBuild.Stdout = os.Stderr
		pkgBuild.Stderr = os.Stderr
		if err := pkgBuild.Run(); err != nil {
			fmt.Fprintf(os.Stderr, "build %s failed: %v\n", pkg, err)
			os.Exit(1)
		}
	}

	// Start TS backend on port 4001
	tsCmd := exec.Command("bun", "run", "demo/backend/typescript/src/index.ts")
	tsCmd.Dir = root
	tsCmd.Env = append(os.Environ(), "PORT=4001")
	tsCmd.Stdout = os.Stderr
	tsCmd.Stderr = os.Stderr
	if err := tsCmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to start TS backend: %v\n", err)
		os.Exit(1)
	}

	// Start Rust backend on port 4002
	rustCmd := exec.Command("cargo", "run", "-p", "demo-backend-rust")
	rustCmd.Dir = root
	rustCmd.Env = append(os.Environ(), "PORT=4002")
	rustCmd.Stdout = os.Stderr
	rustCmd.Stderr = os.Stderr
	if err := rustCmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to start Rust backend: %v\n", err)
		tsCmd.Process.Kill()
		os.Exit(1)
	}

	// Start Node backend on port 4003
	nodeCmd := exec.Command(filepath.Join(root, "node_modules", ".bin", "tsx"),
		"demo/backend/node/src/index.ts")
	nodeCmd.Dir = root
	nodeCmd.Env = append(os.Environ(), "PORT=4003")
	nodeCmd.Stdout = os.Stderr
	nodeCmd.Stderr = os.Stderr
	if err := nodeCmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to start Node backend: %v\n", err)
		tsCmd.Process.Kill()
		rustCmd.Process.Kill()
		os.Exit(1)
	}

	backends = []Backend{
		{Name: "typescript", BaseURL: "http://localhost:4001"},
		{Name: "rust", BaseURL: "http://localhost:4002"},
		{Name: "node", BaseURL: "http://localhost:4003"},
	}

	// Health check: poll manifest endpoint with 15s timeout
	ready := make(chan struct{})
	go func() {
		deadline := time.Now().Add(15 * time.Second)
		for time.Now().Before(deadline) {
			allUp := true
			for _, b := range backends {
				resp, err := http.Get(b.BaseURL + "/seam/manifest.json")
				if err != nil || resp.StatusCode != 200 {
					allUp = false
					break
				}
				resp.Body.Close()
			}
			if allUp {
				close(ready)
				return
			}
			time.Sleep(200 * time.Millisecond)
		}
	}()

	select {
	case <-ready:
		// all backends ready
	case <-time.After(15 * time.Second):
		fmt.Fprintln(os.Stderr, "backends did not become ready within 15s")
		tsCmd.Process.Kill()
		rustCmd.Process.Kill()
		nodeCmd.Process.Kill()
		os.Exit(1)
	}

	code := m.Run()

	tsCmd.Process.Kill()
	rustCmd.Process.Kill()
	nodeCmd.Process.Kill()
	tsCmd.Wait()
	rustCmd.Wait()
	nodeCmd.Wait()

	os.Exit(code)
}
