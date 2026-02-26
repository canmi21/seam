module github.com/canmi21/seam/examples/standalone/server-go

go 1.24.0

require github.com/canmi21/seam/packages/server/core/go v0.0.0

require (
	github.com/canmi21/seam/packages/server/engine/go v0.0.0 // indirect
	github.com/tetratelabs/wazero v1.11.0 // indirect
	golang.org/x/sys v0.38.0 // indirect
)

replace (
	github.com/canmi21/seam/packages/server/core/go => ../../../packages/server/core/go
	github.com/canmi21/seam/packages/server/engine/go => ../../../packages/server/engine/go
)
