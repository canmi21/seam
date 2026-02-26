/* examples/github-dashboard/backends/go-gin/main.go */

package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"

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

	// Load pages from build output if available
	buildDir := os.Getenv("SEAM_OUTPUT_DIR")
	if buildDir == "" {
		buildDir = ".seam/output"
	}
	pages, err := seam.LoadBuildOutput(buildDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "No build output at %s: %v (API-only mode)\n", buildDir, err)
	} else {
		fmt.Fprintf(os.Stderr, "Loaded %d pages from %s\n", len(pages), buildDir)
		for _, page := range pages {
			r.Page(page)
		}
	}

	// Load RPC hash map for production hashed procedure names
	if hashMap := seam.LoadRpcHashMap(buildDir); hashMap != nil {
		fmt.Fprintf(os.Stderr, "RPC hash map loaded (%d procedures)\n", len(hashMap.Procedures))
		r.RpcHashMap(hashMap)
	}

	// Load i18n configuration for runtime locale routing
	if i18nConfig := seam.LoadI18nConfig(buildDir); i18nConfig != nil {
		fmt.Fprintf(os.Stderr, "i18n: %d locales, default=%s\n", len(i18nConfig.Locales), i18nConfig.Default)
		r.I18nConfig(i18nConfig)
	}

	seamHandler := r.Handler()

	// Static assets from build output, served under /_seam/static/*
	publicDir := buildDir + "/public"
	staticFS := http.StripPrefix("/_seam/static/", http.FileServer(http.Dir(publicDir)))

	g := gin.Default()
	g.Any("/_seam/*path", func(c *gin.Context) {
		if strings.HasPrefix(c.Param("path"), "/static/") {
			staticFS.ServeHTTP(c.Writer, c.Request)
			return
		}
		seamHandler.ServeHTTP(c.Writer, c.Request)
	})

	// Root-path page serving: the seam SDK serves pages under /_seam/page/*
	// only, so the application controls its own URL space (public APIs, auth,
	// static files, etc.). Unmatched GET requests are rewritten to /_seam/page/*
	// and forwarded to the seam handler.
	g.NoRoute(func(c *gin.Context) {
		if c.Request.Method != http.MethodGet {
			return
		}
		c.Request.URL.Path = "/_seam/page" + c.Request.URL.Path
		// Reset gin's pending 404 — the seam handler sets the real status
		c.Writer.WriteHeader(http.StatusOK)
		seamHandler.ServeHTTP(c.Writer, c.Request)
	})

	addr := fmt.Sprintf(":%s", port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "listen: %v\n", err)
		os.Exit(1)
	}
	actualPort := ln.Addr().(*net.TCPAddr).Port
	fmt.Printf("GitHub Dashboard (go-gin) running on http://localhost:%d\n", actualPort)
	g.RunListener(ln)
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
					"name": map[string]interface{}{"type": "string", "nullable": true}, "bio": map[string]interface{}{"type": "string", "nullable": true}, "location": map[string]interface{}{"type": "string", "nullable": true},
				}},
			},
			"getUserRepos": map[string]interface{}{
				"type":  "query",
				"input": map[string]interface{}{"properties": map[string]interface{}{"username": map[string]string{"type": "string"}}},
				"output": map[string]interface{}{"elements": map[string]interface{}{"properties": map[string]interface{}{
					"id": map[string]string{"type": "uint32"}, "name": map[string]string{"type": "string"},
					"stargazers_count": map[string]string{"type": "uint32"}, "forks_count": map[string]string{"type": "uint32"}, "html_url": map[string]string{"type": "string"},
					"description": map[string]interface{}{"type": "string", "nullable": true}, "language": map[string]interface{}{"type": "string", "nullable": true},
				}}},
			},
		},
	}

	enc := json.NewEncoder(os.Stdout)
	enc.Encode(manifest)
}
