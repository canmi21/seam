module github.com/canmi21/seam/examples/github-dashboard/backends/go-gin

go 1.24.0

require (
	github.com/canmi21/seam/packages/server/core/go v0.0.0
	github.com/gin-gonic/gin v1.10.0
)

replace (
	github.com/canmi21/seam/packages/server/core/go => ../../../../packages/server/core/go
	github.com/canmi21/seam/packages/server/injector/go => ../../../../packages/server/injector/go
)
