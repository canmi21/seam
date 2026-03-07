/* examples/github-dashboard/backends/go-gin/main.go */

package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"

	seam "github.com/canmi21/seam/src/server/core/go"
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

	// Load all build artifacts (pages, rpcHashMap, i18n) in one call
	buildDir := os.Getenv("SEAM_OUTPUT_DIR")
	if buildDir == "" {
		buildDir = ".seam/output"
	}
	build := seam.LoadBuild(buildDir)
	if len(build.Pages) > 0 {
		fmt.Fprintf(os.Stderr, "Loaded %d pages from %s\n", len(build.Pages), buildDir)
	} else {
		fmt.Fprintf(os.Stderr, "No build output at %s (API-only mode)\n", buildDir)
	}
	if build.RpcHashMap != nil {
		fmt.Fprintf(os.Stderr, "RPC hash map loaded (%d procedures)\n", len(build.RpcHashMap.Procedures))
	}
	if build.I18nConfig != nil {
		fmt.Fprintf(os.Stderr, "i18n: %d locales, default=%s\n", len(build.I18nConfig.Locales), build.I18nConfig.Default)
	}
	r.Build(build)

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
	log.Fatal(g.RunListener(ln))
}

// printManifest outputs the procedure manifest to stdout for build-time
// extraction (seam build --manifest). Uses the same Router.Manifest()
// that produces the runtime /_seam/manifest.json, keeping them in sync.
func printManifest() {
	r := seam.NewRouter()
	r.Procedure(GetSession())
	r.Procedure(GetHomeData())
	r.Procedure(GetUser())
	r.Procedure(GetUserRepos())

	data, err := r.Manifest()
	if err != nil {
		fmt.Fprintf(os.Stderr, "manifest: %v\n", err)
		os.Exit(1)
	}
	_, _ = os.Stdout.Write(data)
	_, _ = os.Stdout.WriteString("\n")
}
