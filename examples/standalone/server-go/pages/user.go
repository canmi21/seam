/* examples/standalone/server-go/pages/user.go */

package pages

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"

	seam "github.com/canmi21/seam/src/server/core/go"
)

func loadTemplate() string {
	// Resolve relative to this source file
	_, thisFile, _, _ := runtime.Caller(0)
	templatePath := filepath.Join(filepath.Dir(thisFile), "..", "..", "templates", "user.html")
	data, err := os.ReadFile(templatePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to read user template: %v\n", err)
		os.Exit(1)
	}
	return string(data)
}

var userTemplate = loadTemplate()

func UserPage() seam.PageDef {
	return seam.PageDef{
		Route:    "/user/:id",
		Template: userTemplate,
		Loaders: []seam.LoaderDef{
			{
				DataKey:   "user",
				Procedure: "getUser",
				InputFn: func(params map[string]string) any {
					id, _ := strconv.ParseUint(params["id"], 10, 32)
					return map[string]any{"id": id}
				},
			},
		},
	}
}
