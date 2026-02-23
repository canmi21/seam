/* examples/standalone/server-go/main.go */

package main

import (
	"fmt"
	"net"
	"net/http"
	"os"

	seam "github.com/canmi21/seam/packages/server/core/go"

	"github.com/canmi21/seam/examples/standalone/server-go/pages"
	"github.com/canmi21/seam/examples/standalone/server-go/procedures"
	"github.com/canmi21/seam/examples/standalone/server-go/subscriptions"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	r := seam.NewRouter()
	r.Procedure(procedures.Greet())
	r.Procedure(procedures.GetUser())
	r.Procedure(procedures.ListUsers())
	r.Subscription(subscriptions.OnCount())
	r.Page(pages.UserPage())

	http.Handle("/_seam/", r.Handler())

	addr := "0.0.0.0:" + port
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to listen: %v\n", err)
		os.Exit(1)
	}

	// Print actual port for integration test discovery
	fmt.Printf("Seam Go backend running on http://localhost:%d\n", ln.Addr().(*net.TCPAddr).Port)
	if err := http.Serve(ln, nil); err != nil {
		fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		os.Exit(1)
	}
}
