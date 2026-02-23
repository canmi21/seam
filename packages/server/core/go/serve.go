/* packages/server/core/go/serve.go */

package seam

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// ListenAndServe starts an HTTP server on addr and blocks until SIGINT or
// SIGTERM is received, then drains in-flight requests with a 5s timeout.
// It prints the actual listening port to stdout for integration test discovery.
// Returns nil on clean shutdown.
func ListenAndServe(addr string, handler http.Handler) error {
	srv := &http.Server{Addr: addr, Handler: handler}

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}

	port := ln.Addr().(*net.TCPAddr).Port
	fmt.Printf("Seam Go backend running on http://localhost:%d\n", port)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	errCh := make(chan error, 1)
	go func() { errCh <- srv.Serve(ln) }()

	select {
	case <-quit:
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return srv.Shutdown(ctx)
	case err := <-errCh:
		if err == http.ErrServerClosed {
			return nil
		}
		return err
	}
}
