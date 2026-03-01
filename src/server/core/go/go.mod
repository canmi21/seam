module github.com/canmi21/seam/src/server/core/go

go 1.24.0

require (
	github.com/canmi21/seam/src/server/engine/go v0.0.0
	github.com/gorilla/websocket v1.5.3
)

require (
	github.com/tetratelabs/wazero v1.11.0 // indirect
	golang.org/x/sys v0.38.0 // indirect
)

replace github.com/canmi21/seam/src/server/engine/go => ../../engine/go
