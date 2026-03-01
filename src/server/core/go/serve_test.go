/* src/server/core/go/serve_test.go */

package seam

import (
	"net/http"
	"os"
	"syscall"
	"testing"
	"time"
)

func TestListenAndServeShutdown(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	errCh := make(chan error, 1)
	go func() {
		errCh <- ListenAndServe(":0", handler)
	}()

	// Give the server time to start
	time.Sleep(50 * time.Millisecond)

	// Send SIGINT to ourselves to trigger graceful shutdown
	p, err := os.FindProcess(os.Getpid())
	if err != nil {
		t.Fatalf("find process: %v", err)
	}
	if err := p.Signal(syscall.SIGINT); err != nil {
		t.Fatalf("send signal: %v", err)
	}

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("expected clean shutdown, got: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown timed out")
	}
}
