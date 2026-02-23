/* packages/server/core/go/seam.go */

package seam

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// Error represents a typed RPC error with a machine-readable code.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func ValidationError(msg string) *Error {
	return &Error{Code: "VALIDATION_ERROR", Message: msg}
}

func NotFoundError(msg string) *Error {
	return &Error{Code: "NOT_FOUND", Message: msg}
}

func InternalError(msg string) *Error {
	return &Error{Code: "INTERNAL_ERROR", Message: msg}
}

// HandlerFunc processes a raw JSON input and returns a result or error.
type HandlerFunc func(ctx context.Context, input json.RawMessage) (any, error)

// ProcedureDef defines a single RPC procedure.
type ProcedureDef struct {
	Name         string
	InputSchema  any
	OutputSchema any
	Handler      HandlerFunc
}

// SubscriptionEvent carries either a value or an error from a subscription stream.
type SubscriptionEvent struct {
	Value any
	Err   *Error
}

// SubscriptionHandlerFunc creates a channel-based event stream from raw JSON input.
type SubscriptionHandlerFunc func(ctx context.Context, input json.RawMessage) (<-chan SubscriptionEvent, error)

// SubscriptionDef defines a streaming subscription.
type SubscriptionDef struct {
	Name         string
	InputSchema  any
	OutputSchema any
	Handler      SubscriptionHandlerFunc
}

// LoaderDef binds a data key to a procedure call with route-param-derived input.
type LoaderDef struct {
	DataKey   string
	Procedure string
	InputFn   func(params map[string]string) any
}

// PageDef defines a server-rendered page with loaders that fetch data before injection.
type PageDef struct {
	Route    string
	Template string
	Loaders  []LoaderDef
}

// Router collects procedure, subscription, and page definitions and
// produces an http.Handler serving the /_seam/* protocol.
type Router struct {
	procedures    []ProcedureDef
	subscriptions []SubscriptionDef
	pages         []PageDef
}

func NewRouter() *Router {
	return &Router{}
}

func (r *Router) Procedure(def ProcedureDef) *Router {
	r.procedures = append(r.procedures, def)
	return r
}

func (r *Router) Subscription(def SubscriptionDef) *Router {
	r.subscriptions = append(r.subscriptions, def)
	return r
}

func (r *Router) Page(def PageDef) *Router {
	r.pages = append(r.pages, def)
	return r
}

// Handler returns an http.Handler that serves all /_seam/* routes.
func (r *Router) Handler() http.Handler {
	return buildHandler(r.procedures, r.subscriptions, r.pages)
}
