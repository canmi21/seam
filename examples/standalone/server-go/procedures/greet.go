/* examples/standalone/server-go/procedures/greet.go */

package procedures

import (
	"context"

	seam "github.com/canmi21/seam/packages/server/core/go"
)

type GreetInput struct {
	Name string `json:"name"`
}

type GreetOutput struct {
	Message string `json:"message"`
}

func Greet() seam.ProcedureDef {
	return seam.Query[GreetInput, GreetOutput]("greet",
		func(ctx context.Context, in GreetInput) (GreetOutput, error) {
			return GreetOutput{Message: "Hello, " + in.Name + "!"}, nil
		})
}
