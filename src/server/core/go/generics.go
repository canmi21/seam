/* src/server/core/go/generics.go */

package seam

import (
	"context"
	"encoding/json"
)

// Query creates a ProcedureDef from a typed handler function.
// It generates JTD schemas from the In/Out type parameters and handles
// JSON deserialization/serialization automatically.
func Query[In, Out any](name string, fn func(context.Context, In) (Out, error)) ProcedureDef {
	return ProcedureDef{
		Name:         name,
		InputSchema:  SchemaOf[In](),
		OutputSchema: SchemaOf[Out](),
		Handler: func(ctx context.Context, raw json.RawMessage) (any, error) {
			var input In
			if err := json.Unmarshal(raw, &input); err != nil {
				return nil, ValidationError("Invalid input: " + err.Error())
			}
			return fn(ctx, input)
		},
	}
}

// Command creates a ProcedureDef with type "command" from a typed handler function.
func Command[In, Out any](name string, fn func(context.Context, In) (Out, error)) ProcedureDef {
	return ProcedureDef{
		Name:         name,
		Type:         "command",
		InputSchema:  SchemaOf[In](),
		OutputSchema: SchemaOf[Out](),
		Handler: func(ctx context.Context, raw json.RawMessage) (any, error) {
			var input In
			if err := json.Unmarshal(raw, &input); err != nil {
				return nil, ValidationError("Invalid input: " + err.Error())
			}
			return fn(ctx, input)
		},
	}
}

// Subscribe creates a SubscriptionDef from a typed handler function.
// The handler returns a channel of Out values; the framework wraps each
// value into a SubscriptionEvent.
func Subscribe[In, Out any](name string, fn func(context.Context, In) (<-chan Out, error)) SubscriptionDef {
	return SubscriptionDef{
		Name:         name,
		InputSchema:  SchemaOf[In](),
		OutputSchema: SchemaOf[Out](),
		Handler: func(ctx context.Context, raw json.RawMessage) (<-chan SubscriptionEvent, error) {
			var input In
			if err := json.Unmarshal(raw, &input); err != nil {
				return nil, ValidationError("Invalid input: " + err.Error())
			}
			dataCh, err := fn(ctx, input)
			if err != nil {
				return nil, err
			}
			eventCh := make(chan SubscriptionEvent)
			go func() {
				defer close(eventCh)
				for val := range dataCh {
					eventCh <- SubscriptionEvent{Value: val}
				}
			}()
			return eventCh, nil
		},
	}
}