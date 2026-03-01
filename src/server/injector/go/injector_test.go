/* src/server/injector/go/injector_test.go */

package injector

import (
	"strings"
	"testing"
)

func TestInjectTextSlot(t *testing.T) {
	result, err := InjectNoScript("<p><!--seam:name--></p>", `{"name":"Alice"}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := "<p>Alice</p>"
	if result != expected {
		t.Errorf("got %q, want %q", result, expected)
	}
}

func TestInjectHTMLEscape(t *testing.T) {
	result, err := InjectNoScript("<p><!--seam:v--></p>", `{"v":"<b>bold</b>"}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := "<p>&lt;b&gt;bold&lt;/b&gt;</p>"
	if result != expected {
		t.Errorf("got %q, want %q", result, expected)
	}
}

func TestInjectNestedPath(t *testing.T) {
	result, err := InjectNoScript(
		"<p><!--seam:user.address.city--></p>",
		`{"user":{"address":{"city":"Tokyo"}}}`,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := "<p>Tokyo</p>"
	if result != expected {
		t.Errorf("got %q, want %q", result, expected)
	}
}

func TestInjectConditionalTrue(t *testing.T) {
	result, err := InjectNoScript(
		"<!--seam:if:show--><p>yes</p><!--seam:endif:show-->",
		`{"show":true}`,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "<p>yes</p>" {
		t.Errorf("got %q, want %q", result, "<p>yes</p>")
	}
}

func TestInjectConditionalFalseWithElse(t *testing.T) {
	result, err := InjectNoScript(
		"<!--seam:if:show-->yes<!--seam:else-->no<!--seam:endif:show-->",
		`{"show":false}`,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "no" {
		t.Errorf("got %q, want %q", result, "no")
	}
}

func TestInjectEachLoop(t *testing.T) {
	result, err := InjectNoScript(
		"<!--seam:each:items--><li><!--seam:$.name--></li><!--seam:endeach-->",
		`{"items":[{"name":"a"},{"name":"b"}]}`,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := "<li>a</li><li>b</li>"
	if result != expected {
		t.Errorf("got %q, want %q", result, expected)
	}
}

func TestInjectAttributeInjection(t *testing.T) {
	result, err := InjectNoScript(
		"<!--seam:cls:attr:class--><div>hi</div>",
		`{"cls":"active"}`,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := `<div class="active">hi</div>`
	if result != expected {
		t.Errorf("got %q, want %q", result, expected)
	}
}

func TestInjectWithDataScript(t *testing.T) {
	result, err := Inject(
		"<body><p>hi</p></body>",
		`{"x":1}`,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(result, `<script id="__SEAM_DATA__"`) {
		t.Errorf("missing __SEAM_DATA__ script in %q", result)
	}
}

func TestInjectMatchWhen(t *testing.T) {
	result, err := InjectNoScript(
		"<!--seam:match:role--><!--seam:when:admin--><b>Admin</b><!--seam:when:guest--><span>Guest</span><!--seam:endmatch-->",
		`{"role":"admin"}`,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "<b>Admin</b>" {
		t.Errorf("got %q, want %q", result, "<b>Admin</b>")
	}
}

func TestInjectStyleInjection(t *testing.T) {
	result, err := InjectNoScript(
		"<!--seam:mt:style:margin-top--><div>text</div>",
		`{"mt":16}`,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := `<div style="margin-top:16px">text</div>`
	if result != expected {
		t.Errorf("got %q, want %q", result, expected)
	}
}

func TestInjectBooleanAttributeTrue(t *testing.T) {
	result, err := InjectNoScript(
		"<!--seam:dis:attr:disabled--><input>",
		`{"dis":true}`,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(result, "disabled") {
		t.Errorf("expected disabled attribute in %q", result)
	}
}

func TestInjectBooleanAttributeFalse(t *testing.T) {
	result, err := InjectNoScript(
		"<!--seam:dis:attr:disabled--><input>",
		`{"dis":false}`,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if strings.Contains(result, "disabled") {
		t.Errorf("expected no disabled attribute in %q", result)
	}
}

// Error path tests: verify graceful handling of edge cases

func TestInjectInvalidJSON(t *testing.T) {
	// Rust uses unwrap_or(Value::Null) for invalid JSON
	result, err := InjectNoScript("<p><!--seam:name--></p>", `{broken`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// With null data, slot resolves to empty
	expected := "<p></p>"
	if result != expected {
		t.Errorf("got %q, want %q", result, expected)
	}
}

func TestInjectEmptyTemplate(t *testing.T) {
	result, err := InjectNoScript("", `{"x":1}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "" {
		t.Errorf("got %q, want empty", result)
	}
}

func TestInjectMissingKey(t *testing.T) {
	result, err := InjectNoScript("<p><!--seam:missing--></p>", `{"other":1}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Missing keys resolve to empty
	expected := "<p></p>"
	if result != expected {
		t.Errorf("got %q, want %q", result, expected)
	}
}