/* tests/integration/main_test.go */

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

// runBuild executes a build command synchronously and exits on failure.
func runBuild(root string, label string, name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.Dir = root
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "%s failed: %v\n", label, err)
		os.Exit(1)
	}
}

func killAll(cmds []*exec.Cmd) {
	for _, c := range cmds {
		c.Process.Kill()
	}
	for _, c := range cmds {
		c.Wait()
	}
}

// startDaemon starts a long-running process with PORT set.
// On failure, kills all previously started daemons before exiting.
func startDaemon(daemons *[]*exec.Cmd, root, port, label string, name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "PORT="+port)
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to start %s: %v\n", label, err)
		killAll(*daemons)
		os.Exit(1)
	}
	*daemons = append(*daemons, cmd)
}

func TestMain(m *testing.M) {
	root := projectRoot()

	// Build Rust backend upfront
	runBuild(root, "cargo build", "cargo", "build", "-p", "demo-server-rust")

	// Build TS packages for Node example
	for _, pkg := range []string{"server/injector", "server/core/typescript", "server/adapter/bun", "server/adapter/node"} {
		runBuild(root, "build "+pkg, "bun", "run", "--cwd", filepath.Join("packages", pkg), "build")
	}

	// Start backend processes
	var daemons []*exec.Cmd
	startDaemon(&daemons, root, "4001", "TS backend", "bun", "run", "examples/server-bun/src/index.ts")
	startDaemon(&daemons, root, "4002", "Rust backend", "cargo", "run", "-p", "demo-server-rust")
	startDaemon(&daemons, root, "4003", "Node backend",
		filepath.Join(root, "node_modules", ".bin", "tsx"), "examples/server-node/src/index.ts")

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
	case <-time.After(15 * time.Second):
		fmt.Fprintln(os.Stderr, "backends did not become ready within 15s")
		killAll(daemons)
		os.Exit(1)
	}

	code := m.Run()
	killAll(daemons)
	os.Exit(code)
}