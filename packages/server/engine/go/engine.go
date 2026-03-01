/* packages/server/engine/go/engine.go */

package engine

import (
	"context"
	_ "embed"
	"fmt"
	"sync"

	"github.com/tetratelabs/wazero"
)

//go:embed engine.wasm
var wasmBytes []byte

var (
	once     sync.Once
	rt       wazero.Runtime
	compiled wazero.CompiledModule
	initErr  error
)

func initialize() {
	ctx := context.Background()
	// Use interpreter engine: the compiler (wazevo) panics on externref tables
	// exported by wasm-bindgen. The interpreter handles them correctly.
	rt = wazero.NewRuntimeWithConfig(ctx, wazero.NewRuntimeConfigInterpreter())

	// Provide the __wbindgen_init_externref_table import as no-op.
	_, err := rt.NewHostModuleBuilder("./seam_engine_wasm_bg.js").
		NewFunctionBuilder().WithFunc(func() {}).
		Export("__wbindgen_init_externref_table").
		Instantiate(ctx)
	if err != nil {
		initErr = fmt.Errorf("host module: %w", err)
		return
	}

	compiled, initErr = rt.CompileModule(ctx, wasmBytes)
}

func ensureInit() error {
	once.Do(initialize)
	return initErr
}

// callWasm invokes a WASM function with N string arguments, returning a string result.
func callWasm(funcName string, args ...string) (string, error) {
	if err := ensureInit(); err != nil {
		return "", err
	}

	ctx := context.Background()

	// Fresh instance per call for isolation
	mod, err := rt.InstantiateModule(ctx, compiled, wazero.NewModuleConfig().WithName(""))
	if err != nil {
		return "", fmt.Errorf("instantiate: %w", err)
	}
	defer mod.Close(ctx)

	// Run wasm-bindgen initialization
	start := mod.ExportedFunction("__wbindgen_start")
	if start != nil {
		if _, err := start.Call(ctx); err != nil {
			return "", fmt.Errorf("wasm start: %w", err)
		}
	}

	malloc := mod.ExportedFunction("__wbindgen_malloc")
	free := mod.ExportedFunction("__wbindgen_free")
	fn := mod.ExportedFunction(funcName)
	if fn == nil {
		return "", fmt.Errorf("function %s not exported", funcName)
	}

	// Write all string arguments to WASM memory
	params := make([]uint64, 0, len(args)*2)
	for _, arg := range args {
		argBytes := []byte(arg)
		res, err := malloc.Call(ctx, uint64(len(argBytes)), 1)
		if err != nil {
			return "", fmt.Errorf("malloc arg: %w", err)
		}
		ptr := uint32(res[0])
		if !mod.Memory().Write(ptr, argBytes) {
			return "", fmt.Errorf("write arg to memory")
		}
		params = append(params, uint64(ptr), uint64(len(argBytes)))
	}

	// Call function
	result, err := fn.Call(ctx, params...)
	if err != nil {
		return "", fmt.Errorf("call %s: %w", funcName, err)
	}

	resultPtr := uint32(result[0])
	resultLen := uint32(result[1])

	// Read result string from WASM memory
	resultBytes, ok := mod.Memory().Read(resultPtr, resultLen)
	if !ok {
		return "", fmt.Errorf("read result from memory")
	}
	output := string(resultBytes)

	// Free result memory
	if free != nil {
		_, _ = free.Call(ctx, uint64(resultPtr), uint64(resultLen), 1)
	}

	return output, nil
}

// RenderPage assembles a page: inject slots, build data script, apply locale/meta.
func RenderPage(template, loaderDataJSON, configJSON, i18nOptsJSON string) (string, error) {
	return callWasm("render_page", template, loaderDataJSON, configJSON, i18nOptsJSON)
}

// ParseBuildOutput parses route-manifest.json into page definitions with layout chains.
func ParseBuildOutput(manifestJSON string) (string, error) {
	return callWasm("parse_build_output", manifestJSON)
}

// ParseI18nConfig extracts i18n configuration from manifest JSON.
func ParseI18nConfig(manifestJSON string) (string, error) {
	return callWasm("parse_i18n_config", manifestJSON)
}

// ParseRpcHashMap builds a reverse lookup from RPC hash map JSON.
func ParseRpcHashMap(hashMapJSON string) (string, error) {
	return callWasm("parse_rpc_hash_map", hashMapJSON)
}

// AsciiEscapeJSON escapes non-ASCII characters in JSON string values.
func AsciiEscapeJSON(json string) (string, error) {
	return callWasm("ascii_escape_json", json)
}

// I18nQuery looks up i18n translation keys from locale messages.
func I18nQuery(keysJSON, locale, defaultLocale, messagesJSON string) (string, error) {
	return callWasm("i18n_query", keysJSON, locale, defaultLocale, messagesJSON)
}

// Inject renders template with data and appends a data script tag using dataID.
func Inject(template, dataJSON, dataID string) (string, error) {
	return callWasm("inject", template, dataJSON, dataID)
}

// InjectNoScript renders template with data without data script tag.
func InjectNoScript(template, dataJSON string) (string, error) {
	return callWasm("inject_no_script", template, dataJSON)
}
