module github.com/canmi21/seam/examples/markdown-demo/server-go

go 1.25.0

require (
	github.com/canmi21/seam/src/server/core/go v0.5.37
	github.com/yuin/goldmark v1.8.2
)

require (
	github.com/canmi21/seam/src/server/engine/go v0.5.37 // indirect
	github.com/dlclark/regexp2 v1.11.4 // indirect
	github.com/dop251/goja v0.0.0-20260311135729-065cd970411c // indirect
	github.com/go-sourcemap/sourcemap v2.1.3+incompatible // indirect
	github.com/google/pprof v0.0.0-20230207041349-798e818bf904 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/tetratelabs/wazero v1.11.0 // indirect
	golang.org/x/sys v0.42.0 // indirect
	golang.org/x/text v0.3.8 // indirect
)

replace (
	github.com/canmi21/seam/src/server/core/go => ../../../src/server/core/go
	github.com/canmi21/seam/src/server/engine/go => ../../../src/server/engine/go
)
