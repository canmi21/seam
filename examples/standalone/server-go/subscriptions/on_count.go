/* examples/standalone/server-go/subscriptions/on_count.go */

package subscriptions

import (
	"context"

	seam "github.com/canmi21/seam/packages/server/core/go"
)

type CountInput struct {
	Max int32 `json:"max"`
}

type CountOutput struct {
	N int32 `json:"n"`
}

func OnCount() seam.SubscriptionDef {
	return seam.Subscribe[CountInput, CountOutput]("onCount",
		func(ctx context.Context, in CountInput) (<-chan CountOutput, error) {
			ch := make(chan CountOutput)
			go func() {
				defer close(ch)
				for i := int32(1); i <= in.Max; i++ {
					ch <- CountOutput{N: i}
				}
			}()
			return ch, nil
		})
}
