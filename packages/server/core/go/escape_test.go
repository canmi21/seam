/* packages/server/core/go/escape_test.go */

package seam

import "testing"

func TestAsciiEscapeJSON(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"ascii passthrough", `{"key":"hello"}`, `{"key":"hello"}`},
		{"escapes CJK in values", `{"msg":"你好"}`, `{"msg":"\u4f60\u597d"}`},
		{"preserves existing escapes", `{"a":"line\nbreak"}`, `{"a":"line\nbreak"}`},
		{"handles escaped quotes", `{"a":"say \"hi\""}`, `{"a":"say \"hi\""}`},
		{"surrogate pair for emoji", `{"emoji":"😀"}`, `{"emoji":"\ud83d\ude00"}`},
		{"mixed ascii and non-ascii", `{"title":"GitHub 仪表盘","cta":"View"}`, `{"title":"GitHub \u4eea\u8868\u76d8","cta":"View"}`},
		{"empty json", `{}`, `{}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := asciiEscapeJSON(tt.input)
			if got != tt.expected {
				t.Errorf("asciiEscapeJSON(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}
