/* packages/server/injector/go/injector.go */

package injector

import (
	"context"
	_ "embed"
	"fmt"
	"sync"

	"github.com/tetratelabs/wazero"
)

//go:embed injector.wasm
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
	// Our inject functions only use string args/returns, no externrefs.
	_, err := rt.NewHostModuleBuilder("./seam_injector_wasm_bg.js").
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

func callWasm(funcName, template, dataJSON string) (string, error) {
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

	// Write template string to WASM memory
	templateBytes := []byte(template)
	res, err := malloc.Call(ctx, uint64(len(templateBytes)), 1)
	if err != nil {
		return "", fmt.Errorf("malloc template: %w", err)
	}
	templatePtr := uint32(res[0])
	if !mod.Memory().Write(templatePtr, templateBytes) {
		return "", fmt.Errorf("write template to memory")
	}

	// Write data JSON string to WASM memory
	dataBytes := []byte(dataJSON)
	res, err = malloc.Call(ctx, uint64(len(dataBytes)), 1)
	if err != nil {
		return "", fmt.Errorf("malloc data: %w", err)
	}
	dataPtr := uint32(res[0])
	if !mod.Memory().Write(dataPtr, dataBytes) {
		return "", fmt.Errorf("write data to memory")
	}

	// Call inject(templatePtr, templateLen, dataPtr, dataLen) -> (resultPtr, resultLen)
	result, err := fn.Call(ctx,
		uint64(templatePtr), uint64(len(templateBytes)),
		uint64(dataPtr), uint64(len(dataBytes)),
	)
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

// Inject renders the template with data and appends __SEAM_DATA__ script.
func Inject(template, dataJSON string) (string, error) {
	return callWasm("inject", template, dataJSON)
}

// InjectNoScript renders the template with data without __SEAM_DATA__ script.
func InjectNoScript(template, dataJSON string) (string, error) {
	return callWasm("inject_no_script", template, dataJSON)
}