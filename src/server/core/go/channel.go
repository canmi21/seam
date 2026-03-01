/* src/server/core/go/channel.go */

package seam

// IncomingDef defines a single incoming message in a channel.
type IncomingDef struct {
	InputSchema  any
	OutputSchema any
	ErrorSchema  any
	Handler      HandlerFunc
}

// ChannelDef defines a bidirectional communication channel.
// A channel groups incoming messages (commands), outgoing events
// (subscription via tagged union), and shared channel-level input.
type ChannelDef struct {
	Name             string
	InputSchema      any
	Incoming         map[string]IncomingDef
	Outgoing         map[string]any // event name -> payload schema
	SubscribeHandler SubscriptionHandlerFunc
}

// channelMeta is the IR hint stored in the manifest.
type channelMeta struct {
	Input    any                     `json:"input"`
	Incoming map[string]incomingMeta `json:"incoming"`
	Outgoing map[string]any          `json:"outgoing"`
}

type incomingMeta struct {
	Input  any `json:"input"`
	Output any `json:"output"`
	Error  any `json:"error,omitempty"`
}

// expand converts a ChannelDef into Level 0 primitives + metadata.
func (ch ChannelDef) expand() ([]ProcedureDef, []SubscriptionDef, channelMeta) {
	var procedures []ProcedureDef
	incomingMetas := make(map[string]incomingMeta)

	for msgName, msgDef := range ch.Incoming {
		mergedInput := mergeObjectSchemas(ch.InputSchema, msgDef.InputSchema)

		procedures = append(procedures, ProcedureDef{
			Name:         ch.Name + "." + msgName,
			Type:         "command",
			InputSchema:  mergedInput,
			OutputSchema: msgDef.OutputSchema,
			ErrorSchema:  msgDef.ErrorSchema,
			Handler:      msgDef.Handler,
		})

		meta := incomingMeta{
			Input:  msgDef.InputSchema,
			Output: msgDef.OutputSchema,
		}
		if msgDef.ErrorSchema != nil {
			meta.Error = msgDef.ErrorSchema
		}
		incomingMetas[msgName] = meta
	}

	// Build tagged union for outgoing events
	mapping := make(map[string]any)
	outgoingMetas := make(map[string]any)
	for eventName, payloadSchema := range ch.Outgoing {
		mapping[eventName] = map[string]any{
			"properties": map[string]any{
				"payload": payloadSchema,
			},
		}
		outgoingMetas[eventName] = payloadSchema
	}
	unionSchema := map[string]any{
		"discriminator": "type",
		"mapping":       mapping,
	}

	subscriptions := []SubscriptionDef{{
		Name:         ch.Name + ".events",
		InputSchema:  ch.InputSchema,
		OutputSchema: unionSchema,
		Handler:      ch.SubscribeHandler,
	}}

	meta := channelMeta{
		Input:    ch.InputSchema,
		Incoming: incomingMetas,
		Outgoing: outgoingMetas,
	}

	return procedures, subscriptions, meta
}

// mergeObjectSchemas merges two JTD object schemas, combining their
// properties and optionalProperties fields.
func mergeObjectSchemas(channel, message any) map[string]any {
	merged := make(map[string]any)

	chMap, _ := channel.(map[string]any)
	msgMap, _ := message.(map[string]any)

	props := make(map[string]any)
	if chProps, ok := chMap["properties"].(map[string]any); ok {
		for k, v := range chProps {
			props[k] = v
		}
	}
	if msgProps, ok := msgMap["properties"].(map[string]any); ok {
		for k, v := range msgProps {
			props[k] = v
		}
	}

	optProps := make(map[string]any)
	if chOpt, ok := chMap["optionalProperties"].(map[string]any); ok {
		for k, v := range chOpt {
			optProps[k] = v
		}
	}
	if msgOpt, ok := msgMap["optionalProperties"].(map[string]any); ok {
		for k, v := range msgOpt {
			optProps[k] = v
		}
	}

	if len(props) > 0 || len(optProps) == 0 {
		merged["properties"] = props
	}
	if len(optProps) > 0 {
		merged["optionalProperties"] = optProps
	}

	return merged
}
