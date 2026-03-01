/* tests/workspace-integration/main_test.go */

package workspace_integration

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

func runBuild(dir string, label string, name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
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

func startDaemon(daemons *[]*exec.Cmd, dir, label string, env []string, name string, args ...string) string {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), append(env, "PORT=0")...)
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
		io.Copy(os.Stderr, stdout)
	}()

	select {
	case port := <-portCh:
		return "http://localhost:" + port
	case <-time.After(30 * time.Second):
		fmt.Fprintf(os.Stderr, "%s did not report its port within 30s\n", label)
		killAll(*daemons)
		os.Exit(1)
		return ""
	}
}

func TestMain(m *testing.M) {
	root := projectRoot()
	backendsDir := filepath.Join(root, "examples", "github-dashboard", "backends")

	// Build TS packages needed by ts-hono backend
	for _, pkg := range []string{"server/core/typescript", "server/adapter/hono"} {
		runBuild(root, "build "+pkg, "bun", "run", "--cwd", filepath.Join("src", pkg), "build")
	}

	// Build Rust backend
	runBuild(root, "cargo build github-dashboard-axum", "cargo", "build", "-p", "github-dashboard-axum")

	// Build Go backend
	goDir := filepath.Join(backendsDir, "go-gin")
	goBin := filepath.Join(goDir, "server-go")
	runBuild(goDir, "go build go-gin", "go", "build", "-o", goBin, ".")

	// Start all 3 backends
	var daemons []*exec.Cmd

	tsURL := startDaemon(&daemons, root, "ts-hono", nil,
		"bun", "run", filepath.Join("examples", "github-dashboard", "backends", "ts-hono", "src", "index.ts"))

	rustBin := filepath.Join(root, "target", "debug", "github-dashboard-axum")
	rustURL := startDaemon(&daemons, root, "rust-axum", nil, rustBin)

	goURL := startDaemon(&daemons, goDir, "go-gin", nil, goBin)

	backends = []Backend{
		{Name: "ts-hono", BaseURL: tsURL},
		{Name: "rust-axum", BaseURL: rustURL},
		{Name: "go-gin", BaseURL: goURL},
	}

	// Health check: poll manifest endpoint
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
		fmt.Fprintln(os.Stderr, "workspace backends did not become ready within 15s")
		killAll(daemons)
		os.Exit(1)
	}

	code := m.Run()
	killAll(daemons)
	os.Exit(code)
}
