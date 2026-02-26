/* packages/server/core/go/seam.go */

package seam

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Error represents a typed RPC error with a machine-readable code.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Status  int    `json:"-"`
}

func (e *Error) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func defaultStatus(code string) int {
	switch code {
	case "VALIDATION_ERROR":
		return http.StatusBadRequest
	case "UNAUTHORIZED":
		return http.StatusUnauthorized
	case "FORBIDDEN":
		return http.StatusForbidden
	case "NOT_FOUND":
		return http.StatusNotFound
	case "RATE_LIMITED":
		return http.StatusTooManyRequests
	case "INTERNAL_ERROR":
		return http.StatusInternalServerError
	default:
		return http.StatusInternalServerError
	}
}

// NewError creates an Error with an explicit HTTP status.
func NewError(code, message string, status int) *Error {
	return &Error{Code: code, Message: message, Status: status}
}

func ValidationError(msg string) *Error {
	return &Error{Code: "VALIDATION_ERROR", Message: msg, Status: http.StatusBadRequest}
}

func NotFoundError(msg string) *Error {
	return &Error{Code: "NOT_FOUND", Message: msg, Status: http.StatusNotFound}
}

func InternalError(msg string) *Error {
	return &Error{Code: "INTERNAL_ERROR", Message: msg, Status: http.StatusInternalServerError}
}

func UnauthorizedError(msg string) *Error {
	return &Error{Code: "UNAUTHORIZED", Message: msg, Status: http.StatusUnauthorized}
}

func ForbiddenError(msg string) *Error {
	return &Error{Code: "FORBIDDEN", Message: msg, Status: http.StatusForbidden}
}

func RateLimitedError(msg string) *Error {
	return &Error{Code: "RATE_LIMITED", Message: msg, Status: http.StatusTooManyRequests}
}

// seamCtxKey is the context key for SeamCtx.
type seamCtxKey struct{}

// SeamCtx carries request-scoped Seam context (e.g. locale) through context.Context.
type SeamCtx struct {
	Locale string
}

// CtxFromContext extracts SeamCtx from a context. Returns a zero-value SeamCtx if not set.
func CtxFromContext(ctx context.Context) *SeamCtx {
	if v, ok := ctx.Value(seamCtxKey{}).(*SeamCtx); ok {
		return v
	}
	return &SeamCtx{}
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

// LayoutChainEntry represents one layout in the chain (outer to inner order).
// Each layout owns a set of loader data keys.
type LayoutChainEntry struct {
	ID         string
	LoaderKeys []string
}

// PageDef defines a server-rendered page with loaders that fetch data before injection.
type PageDef struct {
	Route           string
	Template        string
	LocaleTemplates map[string]string // locale -> pre-resolved template HTML (layout chain applied)
	Loaders         []LoaderDef
	DataID          string             // script ID for the injected data JSON (default "__SEAM_DATA__")
	LayoutChain     []LayoutChainEntry // layout chain from outer to inner with per-layout loader keys
	PageLoaderKeys  []string           // data keys from page-level loaders (not layout)
	I18nKeys        []string           // merged i18n keys from route + layout chain; empty means include all
}

// I18nConfig holds runtime i18n state loaded from build output.
type I18nConfig struct {
	Locales  []string
	Default  string
	Messages map[string]json.RawMessage // locale -> messages JSON
	Versions map[string]string          // per-locale content hash for cache invalidation
}

// HandlerOptions configures timeout behavior for the generated handler.
// Zero values disable the corresponding timeout.
type HandlerOptions struct {
	RPCTimeout     time.Duration // per-RPC call timeout (default 30s)
	PageTimeout    time.Duration // aggregate page-loader timeout (default 30s)
	SSEIdleTimeout time.Duration // idle timeout between SSE events (default 30s)
}

var defaultHandlerOptions = HandlerOptions{
	RPCTimeout:     30 * time.Second,
	PageTimeout:    30 * time.Second,
	SSEIdleTimeout: 30 * time.Second,
}

// Router collects procedure, subscription, and page definitions and
// produces an http.Handler serving the /_seam/* protocol.
type Router struct {
	procedures    []ProcedureDef
	subscriptions []SubscriptionDef
	pages         []PageDef
	rpcHashMap    *RpcHashMap
	i18nConfig    *I18nConfig
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

func (r *Router) RpcHashMap(m *RpcHashMap) *Router {
	r.rpcHashMap = m
	return r
}

func (r *Router) I18nConfig(config *I18nConfig) *Router {
	r.i18nConfig = config
	return r
}

// Handler returns an http.Handler that serves all /_seam/* routes.
// When called with no arguments, default timeouts (30s) are used.
func (r *Router) Handler(opts ...HandlerOptions) http.Handler {
	o := defaultHandlerOptions
	if len(opts) > 0 {
		o = opts[0]
	}
	return buildHandler(r.procedures, r.subscriptions, r.pages, r.rpcHashMap, r.i18nConfig, o)
}
