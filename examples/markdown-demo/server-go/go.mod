module github.com/canmi21/seam/examples/markdown-demo/server-go

go 1.25.0

require (
	github.com/canmi21/seam/src/server/core/go v0.0.0
	github.com/yuin/goldmark v1.7.16
)

require (
	github.com/canmi21/seam/src/server/engine/go v0.0.0 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/tetratelabs/wazero v1.11.0 // indirect
	golang.org/x/sys v0.41.0 // indirect
)

replace (
	github.com/canmi21/seam/src/server/core/go => ../../../src/server/core/go
	github.com/canmi21/seam/src/server/engine/go => ../../../src/server/engine/go
)
