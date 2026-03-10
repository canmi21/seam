/* src/server/core/go/seam.go */

package seam

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Error represents a typed RPC error with a machine-readable code.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Status  int    `json:"-"`
	Details []any  `json:"-"`
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
	case "CONTEXT_ERROR":
		return http.StatusBadRequest
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

func ContextError(msg string) *Error {
	return &Error{Code: "CONTEXT_ERROR", Message: msg, Status: http.StatusBadRequest}
}

func ValidationErrorDetailed(msg string, details []any) *Error {
	return &Error{Code: "VALIDATION_ERROR", Message: msg, Status: http.StatusBadRequest, Details: details}
}

type lastEventIDKeyType struct{}

var lastEventIDKey = lastEventIDKeyType{}

// LastEventID returns the Last-Event-ID header value from the context, if any.
func LastEventID(ctx context.Context) string {
	if v, ok := ctx.Value(lastEventIDKey).(string); ok {
		return v
	}
	return ""
}

// HandlerFunc processes a raw JSON input and returns a result or error.
type HandlerFunc func(ctx context.Context, input json.RawMessage) (any, error)

// ProcedureDef defines a single RPC procedure.
type ProcedureDef struct {
	Name         string
	Type         string // "query" (default) or "command"
	InputSchema  any
	OutputSchema any
	ErrorSchema  any      // optional: JTD schema for typed errors
	ContextKeys  []string // context keys this procedure requires
	Suppress     []string // optional: suppressed warnings for client SDK
	Cache        any      // optional: false | map[string]any{"ttl": N}
	Handler      HandlerFunc
}

// ProcedureOption configures optional fields on a ProcedureDef.
type ProcedureOption func(*ProcedureDef)

// WithProcedureContext declares which context keys a procedure needs.
func WithProcedureContext(keys ...string) ProcedureOption {
	return func(p *ProcedureDef) {
		p.ContextKeys = append(p.ContextKeys, keys...)
	}
}

// WithSuppress declares warnings to suppress in client SDK.
func WithSuppress(warnings ...string) ProcedureOption {
	return func(p *ProcedureDef) {
		p.Suppress = append(p.Suppress, warnings...)
	}
}

// WithCache sets the cache hint for this procedure.
func WithCache(cache any) ProcedureOption {
	return func(p *ProcedureDef) {
		p.Cache = cache
	}
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
	ErrorSchema  any      // optional: JTD schema for typed errors
	ContextKeys  []string // context keys this subscription requires
	Suppress     []string // optional: suppressed warnings for client SDK
	Handler      SubscriptionHandlerFunc
}

// StreamEvent carries either a chunk value or an error from a stream.
type StreamEvent struct {
	Value any
	Err   *Error
}

// StreamHandlerFunc creates a channel-based chunk stream from raw JSON input.
type StreamHandlerFunc func(ctx context.Context, input json.RawMessage) (<-chan StreamEvent, error)

// StreamDef defines a streaming procedure (SSE with incrementing id).
type StreamDef struct {
	Name              string
	InputSchema       any
	ChunkOutputSchema any
	ErrorSchema       any      // optional: JTD schema for typed errors
	ContextKeys       []string // context keys this stream requires
	Suppress          []string // optional: suppressed warnings for client SDK
	Handler           StreamHandlerFunc
}

// SeamFileHandle holds an uploaded file's metadata and reader.
type SeamFileHandle struct {
	Reader   io.Reader
	Filename string
	Size     int64
}

// UploadHandlerFunc processes an uploaded file with JSON metadata.
type UploadHandlerFunc func(ctx context.Context, input json.RawMessage, file *SeamFileHandle) (any, error)

// UploadDef defines an upload procedure (multipart/form-data).
type UploadDef struct {
	Name         string
	InputSchema  any
	OutputSchema any
	ErrorSchema  any      // optional: JTD schema for typed errors
	ContextKeys  []string // context keys this upload requires
	Suppress     []string // optional: suppressed warnings for client SDK
	Handler      UploadHandlerFunc
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

// PageAssets holds per-page asset references resolved at build time.
type PageAssets struct {
	Styles   []string `json:"styles"`
	Scripts  []string `json:"scripts"`
	Preload  []string `json:"preload"`
	Prefetch []string `json:"prefetch"`
}

// PageDef defines a server-rendered page with loaders that fetch data before injection.
type PageDef struct {
	Route           string
	Template        string
	LocaleTemplates map[string]string // locale -> pre-resolved template HTML (layout chain applied)
	Loaders         []LoaderDef
	DataID          string              // script ID for the injected data JSON (default "__data")
	LayoutChain     []LayoutChainEntry  // layout chain from outer to inner with per-layout loader keys
	PageLoaderKeys  []string            // data keys from page-level loaders (not layout)
	I18nKeys        []string            // merged i18n keys from route + layout chain; empty means include all
	HeadMeta        string              // head metadata HTML (injected at render time by engine)
	Assets          *PageAssets         // per-page CSS/JS/preload/prefetch (nil when splitting is off)
	Projections     map[string][]string // per-loader field projections for schema narrowing (nil = no narrowing)
	Prerender       bool                // SSG: serve pre-rendered static HTML instead of running loaders
	StaticDir       string              // SSG: directory containing pre-rendered HTML files
}

// I18nConfig holds runtime i18n state loaded from build output.
type I18nConfig struct {
	Locales       []string
	Default       string
	Mode          string                                // "memory" or "paged"
	Cache         bool                                  // whether to inject content hash router
	RouteHashes   map[string]string                     // route pattern -> route hash (8 hex)
	ContentHashes map[string]map[string]string          // route hash -> { locale -> content hash (4 hex) }
	Messages      map[string]map[string]json.RawMessage // memory: locale -> routeHash -> msgs
	DistDir       string                                // paged: base directory for on-demand reads
}

// HandlerOptions configures timeout behavior for the generated handler.
// Zero values disable the corresponding timeout.
type HandlerOptions struct {
	RPCTimeout        time.Duration // per-RPC call timeout (default 30s)
	PageTimeout       time.Duration // aggregate page-loader timeout (default 30s)
	SSEIdleTimeout    time.Duration // idle timeout between SSE events (default 30s)
	HeartbeatInterval time.Duration // SSE/WS heartbeat interval (default 21s)
	PongTimeout       time.Duration // pong deadline after ping (default 5s)
}

var defaultHandlerOptions = HandlerOptions{
	RPCTimeout:        30 * time.Second,
	PageTimeout:       30 * time.Second,
	SSEIdleTimeout:    30 * time.Second,
	HeartbeatInterval: 21 * time.Second,
	PongTimeout:       5 * time.Second,
}

// Router collects procedure, subscription, channel, and page definitions and
// produces an http.Handler serving the /_seam/* protocol.
type Router struct {
	procedures     []ProcedureDef
	subscriptions  []SubscriptionDef
	streams        []StreamDef
	uploads        []UploadDef
	channels       []ChannelDef
	pages          []PageDef
	rpcHashMap     *RpcHashMap
	i18nConfig     *I18nConfig
	publicDir      string
	strategies     []ResolveStrategy
	contextConfigs map[string]ContextConfig
	validationMode ValidationMode
}

func NewRouter() *Router {
	return &Router{}
}

// Context registers a context field definition for extraction from HTTP requests.
func (r *Router) Context(key string, config ContextConfig) *Router {
	if r.contextConfigs == nil {
		r.contextConfigs = make(map[string]ContextConfig)
	}
	r.contextConfigs[key] = config
	return r
}

// Validation sets when input validation is applied.
func (r *Router) Validation(mode ValidationMode) *Router {
	r.validationMode = mode
	return r
}

func (r *Router) Procedure(def *ProcedureDef) *Router {
	r.procedures = append(r.procedures, *def)
	return r
}

func (r *Router) Subscription(def *SubscriptionDef) *Router {
	r.subscriptions = append(r.subscriptions, *def)
	return r
}

func (r *Router) Stream(def *StreamDef) *Router {
	r.streams = append(r.streams, *def)
	return r
}

func (r *Router) Upload(def *UploadDef) *Router {
	r.uploads = append(r.uploads, *def)
	return r
}

func (r *Router) Channel(def ChannelDef) *Router {
	r.channels = append(r.channels, def)
	return r
}

// Namespace registers procedures under a dot-separated prefix (e.g. "blog" -> "blog.getPost").
func (r *Router) Namespace(prefix string, procs ...*ProcedureDef) *Router {
	for _, p := range procs {
		p.Name = prefix + "." + p.Name
		r.procedures = append(r.procedures, *p)
	}
	return r
}

// NamespaceSubs registers subscriptions under a dot-separated prefix.
func (r *Router) NamespaceSubs(prefix string, subs ...*SubscriptionDef) *Router {
	for _, s := range subs {
		s.Name = prefix + "." + s.Name
		r.subscriptions = append(r.subscriptions, *s)
	}
	return r
}

// NamespaceStreams registers streams under a dot-separated prefix.
func (r *Router) NamespaceStreams(prefix string, streams ...*StreamDef) *Router {
	for _, s := range streams {
		s.Name = prefix + "." + s.Name
		r.streams = append(r.streams, *s)
	}
	return r
}

func (r *Router) Page(def *PageDef) *Router {
	r.pages = append(r.pages, *def)
	return r
}

// Build applies all artifacts from a BuildOutput to the router.
func (r *Router) Build(b BuildOutput) *Router {
	r.pages = append(r.pages, b.Pages...)
	if b.RpcHashMap != nil {
		r.rpcHashMap = b.RpcHashMap
	}
	if b.I18nConfig != nil {
		r.i18nConfig = b.I18nConfig
	}
	if b.PublicDir != "" {
		r.publicDir = b.PublicDir
	}
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

func (r *Router) ResolveStrategies(strategies ...ResolveStrategy) *Router {
	r.strategies = strategies
	return r
}

// Manifest returns the JSON-serialized manifest for build-time extraction
// (e.g. printing to stdout with --manifest). Channels are expanded to
// Level 0 primitives, matching the runtime manifest exactly.
func (r *Router) Manifest() ([]byte, error) {
	var channelMetas map[string]channelMeta
	// Collect procedure/subscription copies so we don't mutate Router state
	procs := append([]ProcedureDef{}, r.procedures...)
	subs := append([]SubscriptionDef{}, r.subscriptions...)
	for _, ch := range r.channels {
		p, s, meta := ch.expand()
		procs = append(procs, p...)
		subs = append(subs, s...)
		if channelMetas == nil {
			channelMetas = make(map[string]channelMeta)
		}
		channelMetas[ch.Name] = meta
	}
	m := buildManifest(procs, subs, r.streams, r.uploads, channelMetas, r.contextConfigs)
	return json.Marshal(m)
}

// Handler returns an http.Handler that serves all /_seam/* routes.
// When called with no arguments, default timeouts (30s) are used.
func (r *Router) Handler(opts ...HandlerOptions) http.Handler {
	o := defaultHandlerOptions
	if len(opts) > 0 {
		o = opts[0]
		// HeartbeatInterval 0 means use default (unlike other timeouts where 0 disables)
		if o.HeartbeatInterval == 0 {
			o.HeartbeatInterval = defaultHandlerOptions.HeartbeatInterval
		}
		if o.PongTimeout == 0 {
			o.PongTimeout = defaultHandlerOptions.PongTimeout
		}
	}
	return buildHandler(r.procedures, r.subscriptions, r.streams, r.uploads, r.channels, r.pages, r.rpcHashMap, r.i18nConfig, r.publicDir, r.strategies, r.contextConfigs, o, r.validationMode)
}
