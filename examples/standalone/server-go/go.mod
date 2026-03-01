module github.com/canmi21/seam/examples/standalone/server-go

go 1.24.0

require github.com/canmi21/seam/src/server/core/go v0.0.0

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
