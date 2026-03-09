/* tests/markdown-demo/main_test.go */

package markdown_demo

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

func runBuild(root, label, name string, args ...string) {
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
		_ = c.Process.Kill()
	}
	for _, c := range cmds {
		_ = c.Wait()
	}
}

var portRe = regexp.MustCompile(`http://localhost:(\d+)`)

func startDaemon(daemons *[]*exec.Cmd, root, label, name string, args ...string) string {
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
		_, _ = io.Copy(os.Stderr, stdout)
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

	// Build Rust backend
	runBuild(root, "cargo build", "cargo", "build", "-p", "markdown-demo-rust")

	// Build Go backend
	goDir := filepath.Join(root, "examples", "markdown-demo", "server-go")
	goBin := filepath.Join(goDir, "server-go")
	runBuild(goDir, "go build server-go", "go", "build", "-o", goBin, ".")

	// Build TS packages required by bun backend
	for _, pkg := range []string{"server/core/typescript", "server/adapter/bun"} {
		runBuild(root, "build "+pkg, "bun", "run", "--cwd", filepath.Join("src", pkg), "build")
	}

	// Start all three backends on OS-assigned ports
	var daemons []*exec.Cmd
	tsURL := startDaemon(&daemons, root, "TS backend", "bun", "run", "examples/markdown-demo/server-ts/src/index.ts")
	rustURL := startDaemon(&daemons, root, "Rust backend", "cargo", "run", "-p", "markdown-demo-rust")
	goURL := startDaemon(&daemons, root, "Go backend", goBin)

	backends = []Backend{
		{Name: "typescript", BaseURL: tsURL},
		{Name: "rust", BaseURL: rustURL},
		{Name: "go", BaseURL: goURL},
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
				_ = resp.Body.Close()
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
