/* examples/github-dashboard/backends/go-gin/main.go */

package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/gin-gonic/gin"

	seam "github.com/canmi21/seam/packages/server/core/go"
)

func main() {
	// --manifest flag: print procedure manifest JSON to stdout and exit
	for _, arg := range os.Args[1:] {
		if arg == "--manifest" {
			printManifest()
			return
		}
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	r := seam.NewRouter()
	r.Procedure(GetSession())
	r.Procedure(GetHomeData())
	r.Procedure(GetUser())
	r.Procedure(GetUserRepos())

	g := gin.Default()
	g.Any("/_seam/*path", gin.WrapH(r.Handler()))

	addr := fmt.Sprintf(":%s", port)
	fmt.Printf("GitHub Dashboard (go-gin) running on http://localhost:%s\n", port)
	g.Run(addr)
}

func printManifest() {
	manifest := map[string]interface{}{
		"version": "0.1.0",
		"procedures": map[string]interface{}{
			"getSession": map[string]interface{}{
				"type":   "query",
				"input":  map[string]interface{}{"properties": map[string]interface{}{}},
				"output": map[string]interface{}{"properties": map[string]interface{}{"username": map[string]string{"type": "string"}, "theme": map[string]string{"type": "string"}}},
			},
			"getHomeData": map[string]interface{}{
				"type":   "query",
				"input":  map[string]interface{}{"properties": map[string]interface{}{}},
				"output": map[string]interface{}{"properties": map[string]interface{}{"tagline": map[string]string{"type": "string"}}},
			},
			"getUser": map[string]interface{}{
				"type":  "query",
				"input": map[string]interface{}{"properties": map[string]interface{}{"username": map[string]string{"type": "string"}}},
				"output": map[string]interface{}{"properties": map[string]interface{}{
					"login": map[string]string{"type": "string"}, "avatar_url": map[string]string{"type": "string"},
					"public_repos": map[string]string{"type": "uint32"}, "followers": map[string]string{"type": "uint32"}, "following": map[string]string{"type": "uint32"},
				}, "optionalProperties": map[string]interface{}{
					"name": map[string]interface{}{"type": "string", "nullable": true}, "bio": map[string]interface{}{"type": "string", "nullable": true}, "location": map[string]interface{}{"type": "string", "nullable": true},
				}},
			},
			"getUserRepos": map[string]interface{}{
				"type":  "query",
				"input": map[string]interface{}{"properties": map[string]interface{}{"username": map[string]string{"type": "string"}}},
				"output": map[string]interface{}{"elements": map[string]interface{}{"properties": map[string]interface{}{
					"id": map[string]string{"type": "uint32"}, "name": map[string]string{"type": "string"},
					"stargazers_count": map[string]string{"type": "uint32"}, "forks_count": map[string]string{"type": "uint32"}, "html_url": map[string]string{"type": "string"},
				}, "optionalProperties": map[string]interface{}{
					"description": map[string]interface{}{"type": "string", "nullable": true}, "language": map[string]interface{}{"type": "string", "nullable": true},
				}}},
			},
		},
	}

	enc := json.NewEncoder(os.Stdout)
	enc.Encode(manifest)
}
