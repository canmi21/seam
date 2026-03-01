/* src/server/injector/go/injector.go */

package injector

import (
	"context"
	_ "embed"
	"encoding/binary"
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
	rt = wazero.NewRuntimeWithConfig(ctx, wazero.NewRuntimeConfigInterpreter())
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

	malloc := mod.ExportedFunction("__wbindgen_export")
	free := mod.ExportedFunction("__wbindgen_export3")
	stackPointer := mod.ExportedFunction("__wbindgen_add_to_stack_pointer")
	fn := mod.ExportedFunction(funcName)
	if fn == nil {
		return "", fmt.Errorf("function %s not exported", funcName)
	}
	if malloc == nil {
		return "", fmt.Errorf("__wbindgen_export (malloc) not exported")
	}
	if stackPointer == nil {
		return "", fmt.Errorf("__wbindgen_add_to_stack_pointer not exported")
	}

	// Allocate stack space for return values (ptr + len = 8 bytes, padded to 16)
	spRes, err := stackPointer.Call(ctx, uint64(^uint32(15)))
	if err != nil {
		return "", fmt.Errorf("stack pointer alloc: %w", err)
	}
	retptr := uint32(spRes[0])

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

	// Call function with retptr as first arg (results written to retptr, not returned)
	_, err = fn.Call(ctx,
		uint64(retptr),
		uint64(templatePtr), uint64(len(templateBytes)),
		uint64(dataPtr), uint64(len(dataBytes)),
	)
	if err != nil {
		return "", fmt.Errorf("call %s: %w", funcName, err)
	}

	// Read return values from stack memory
	retBytes, ok := mod.Memory().Read(retptr, 8)
	if !ok {
		return "", fmt.Errorf("read return values from stack")
	}
	resultPtr := binary.LittleEndian.Uint32(retBytes[0:4])
	resultLen := binary.LittleEndian.Uint32(retBytes[4:8])

	// Restore stack pointer
	_, _ = stackPointer.Call(ctx, 16)

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

// Inject renders the template with data and appends a data script tag.
// Deprecated: uses injector.wasm which hard-codes "__SEAM_DATA__" as data ID.
// Prefer engine.Inject which accepts a configurable data ID.
func Inject(template, dataJSON string) (string, error) {
	return callWasm("inject", template, dataJSON)
}

// InjectNoScript renders the template with data without data script tag.
func InjectNoScript(template, dataJSON string) (string, error) {
	return callWasm("inject_no_script", template, dataJSON)
}
