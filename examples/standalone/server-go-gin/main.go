/* examples/standalone/server-go-gin/main.go */

package main

import (
	"fmt"
	"os"

	"github.com/gin-gonic/gin"

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

	g := gin.Default()
	g.Any("/_seam/*path", gin.WrapH(r.Handler()))

	// For production graceful shutdown, replace g.Run with
	// http.Server + srv.Shutdown, or use seam.ListenAndServe.
	addr := fmt.Sprintf(":%s", port)
	fmt.Printf("Seam Go+Gin backend running on http://localhost:%s\n", port)
	g.Run(addr)
}
