/* examples/standalone/server-go-gin/main.go */

package main

import (
	"fmt"
	"log"
	"os"

	"github.com/gin-gonic/gin"

	seam "github.com/canmi21/seam/src/server/core/go"

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

	fmt.Printf("Seam Go+Gin backend running on http://localhost:%s\n", port)
	log.Fatal(seam.ListenAndServe(fmt.Sprintf(":%s", port), g.Handler()))
}
