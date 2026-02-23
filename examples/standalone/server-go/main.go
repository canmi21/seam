/* examples/standalone/server-go/main.go */

package main

import (
	"fmt"
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

	mux := http.NewServeMux()
	mux.Handle("/_seam/", r.Handler())

	if err := seam.ListenAndServe("0.0.0.0:"+port, mux); err != nil {
		fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		os.Exit(1)
	}
}
