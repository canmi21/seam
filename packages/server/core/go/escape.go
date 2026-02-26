/* packages/server/core/go/escape.go */

package seam

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// asciiEscapeJSON escapes non-ASCII characters in JSON string values to
// \uXXXX sequences. It tracks whether the current position is inside a
// JSON string (handling \" and \\ correctly). Codepoints outside the BMP
// are encoded as surrogate pairs (\uHHHH\uLLLL).
func asciiEscapeJSON(s string) string {
	var b strings.Builder
	b.Grow(len(s))

	inString := false
	i := 0
	for i < len(s) {
		r, size := utf8.DecodeRuneInString(s[i:])

		if inString {
			if r == '\\' {
				// Escaped character inside string: copy both bytes and skip next
				b.WriteByte(s[i])
				i++
				if i < len(s) {
					b.WriteByte(s[i])
					i++
				}
				continue
			}
			if r == '"' {
				inString = false
				b.WriteByte('"')
				i++
				continue
			}
			if r > 0x7F {
				if r > 0xFFFF {
					// Surrogate pair for chars outside BMP
					adjusted := r - 0x10000
					hi := (adjusted >> 10) + 0xD800
					lo := (adjusted & 0x3FF) + 0xDC00
					fmt.Fprintf(&b, "\\u%04x\\u%04x", hi, lo)
				} else {
					fmt.Fprintf(&b, "\\u%04x", r)
				}
				i += size
				continue
			}
			b.WriteByte(s[i])
			i++
		} else {
			if r == '"' {
				inString = true
			}
			b.WriteByte(s[i])
			i++
		}
	}
	return b.String()
}
