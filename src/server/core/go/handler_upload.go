/* src/server/core/go/handler_upload.go */

package seam

import (
	"encoding/json"
	"fmt"
	"net/http"
)

func (s *appState) handleUpload(w http.ResponseWriter, r *http.Request, name string) {
	upload, ok := s.uploads[name]
	if !ok {
		writeError(w, http.StatusNotFound, NotFoundError(fmt.Sprintf("Upload procedure '%s' not found", name)))
		return
	}

	err := r.ParseMultipartForm(32 << 20) // 32 MB max
	if err != nil {
		writeError(w, http.StatusBadRequest, ValidationError("Failed to parse multipart form: "+err.Error()))
		return
	}

	// Extract metadata field (JSON string)
	metadataStr := r.FormValue("metadata")
	var metadata json.RawMessage
	if metadataStr != "" {
		metadata = json.RawMessage(metadataStr)
		if !json.Valid(metadata) {
			writeError(w, http.StatusBadRequest, ValidationError("Invalid JSON in metadata field"))
			return
		}
	} else {
		metadata = json.RawMessage("{}")
	}

	if s.shouldValidate {
		if cs, ok := s.compiledUploadSchemas[name]; ok {
			var parsed any
			_ = json.Unmarshal(metadata, &parsed)
			if msg, details := validateCompiled(cs, parsed); msg != "" {
				writeError(w, http.StatusBadRequest, ValidationErrorDetailed(
					fmt.Sprintf("Input validation failed for upload '%s': %s", name, msg), toAnySlice(details)))
				return
			}
		}
	}

	// Extract file field
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, ValidationError("Missing 'file' field in multipart form"))
		return
	}
	defer func() { _ = file.Close() }()

	fileHandle := &SeamFileHandle{
		Reader:   file,
		Filename: header.Filename,
		Size:     header.Size,
	}

	ctx := r.Context()
	if len(s.contextConfigs) > 0 && len(upload.ContextKeys) > 0 {
		rawCtx := extractRawContext(r, s.contextConfigs)
		filtered := resolveContextForProc(rawCtx, upload.ContextKeys)
		ctx = injectContext(ctx, filtered)
	}

	result, err := upload.Handler(ctx, metadata, fileHandle)
	if err != nil {
		if seamErr, ok := err.(*Error); ok {
			status := errorHTTPStatus(seamErr)
			writeError(w, status, seamErr)
		} else {
			writeError(w, http.StatusInternalServerError, InternalError(err.Error()))
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": result})
}
