/* tests/integration/main_test.go */

package integration

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
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

var portRe = regexp.MustCompile(`http://localhost:(\d+)`)

// startDaemon starts a long-running process with PORT=0 (OS-assigned port).
// It reads stdout until the backend logs its URL, extracts the actual port,
// and returns the base URL. On failure, kills all previously started daemons.
func startDaemon(daemons *[]*exec.Cmd, root, label string, name string, args ...string) string {
	cmd := exec.Command(name, args...)
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "PORT=0")
	cmd.Stderr = os.Stderr

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to pipe stdout for %s: %v\n", label, err)
		killAll(*daemons)
		os.Exit(1)
	}

	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to start %s: %v\n", label, err)
		killAll(*daemons)
		os.Exit(1)
	}
	*daemons = append(*daemons, cmd)

	// Read stdout lines until we find the port announcement
	portCh := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			fmt.Fprintln(os.Stderr, label+": "+line)
			if m := portRe.FindStringSubmatch(line); m != nil {
				portCh <- m[1]
				break
			}
		}
		// Keep draining stdout to prevent blocking
		io.Copy(os.Stderr, stdout)
	}()

	select {
	case port := <-portCh:
		return "http://localhost:" + port
	case <-time.After(15 * time.Second):
		fmt.Fprintf(os.Stderr, "%s did not report its port within 15s\n", label)
		killAll(*daemons)
		os.Exit(1)
		return ""
	}
}

func TestMain(m *testing.M) {
	root := projectRoot()

	// Build Rust backend upfront
	runBuild(root, "cargo build", "cargo", "build", "-p", "demo-server-rust")

	// Build Go backend
	goBin := filepath.Join(root, "examples", "standalone", "server-go", "server-go")
	goDir := filepath.Join(root, "examples", "standalone", "server-go")
	runBuild(goDir, "go build server-go", "go", "build", "-o", goBin, ".")

	// Build TS packages for Node example
	for _, pkg := range []string{"server/injector", "server/core/typescript", "server/adapter/bun", "server/adapter/node"} {
		runBuild(root, "build "+pkg, "bun", "run", "--cwd", filepath.Join("packages", pkg), "build")
	}

	// Start backend processes on OS-assigned ports
	var daemons []*exec.Cmd
	tsURL := startDaemon(&daemons, root, "TS backend", "bun", "run", "examples/standalone/server-bun/src/index.ts")
	rustURL := startDaemon(&daemons, root, "Rust backend", "cargo", "run", "-p", "demo-server-rust")
	nodeURL := startDaemon(&daemons, root, "Node backend",
		filepath.Join(root, "node_modules", ".bin", "tsx"), "examples/standalone/server-node/src/index.ts")
	goURL := startDaemon(&daemons, root, "Go backend", goBin)

	backends = []Backend{
		{Name: "typescript", BaseURL: tsURL},
		{Name: "rust", BaseURL: rustURL},
		{Name: "node", BaseURL: nodeURL},
		{Name: "go", BaseURL: goURL},
	}

	// Health check: poll manifest endpoint with 15s timeout
	ready := make(chan struct{})
	go func() {
		deadline := time.Now().Add(15 * time.Second)
		for time.Now().Before(deadline) {
			allUp := true
			for _, b := range backends {
				resp, err := http.Get(b.BaseURL + "/_seam/manifest.json")
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
