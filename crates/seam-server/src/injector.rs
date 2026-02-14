use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

static COND_OPEN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<!--seam:if:([\w.]+)-->").unwrap());
static ATTR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<!--seam:([\w.]+):attr:(\w+)-->").unwrap());
static RAW_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<!--seam:([\w.]+):html-->").unwrap());
static TEXT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<!--seam:([\w.]+)-->").unwrap());

fn resolve<'a>(path: &str, data: &'a Value) -> Option<&'a Value> {
    let mut current = data;
    for key in path.split('.') {
        current = current.get(key)?;
    }
    Some(current)
}

fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i != 0
            } else if let Some(f) = n.as_f64() {
                f != 0.0
            } else {
                true
            }
        }
        Value::String(s) => !s.is_empty(),
        // Objects and arrays are always truthy (JS-style)
        _ => true,
    }
}

fn stringify(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#x27;"),
            c => out.push(c),
        }
    }
    out
}

struct CondMatch {
    full_start: usize,
    inner_start: usize,
    inner_end: usize,
    full_end: usize,
    path: String,
}

/// Find innermost <!--seam:if:PATH-->...<!--seam:endif:PATH--> and replace.
/// Returns None if no conditional pair found.
fn replace_one_conditional(input: &str, data: &Value) -> Option<String> {
    let mut innermost: Option<CondMatch> = None;

    for m in COND_OPEN_RE.find_iter(input) {
        let caps = COND_OPEN_RE.captures(&input[m.start()..]).unwrap();
        let p = caps.get(1).unwrap().as_str();
        let endif_tag = format!("<!--seam:endif:{}-->", p);
        if let Some(endif_pos) = input[m.end()..].find(&endif_tag) {
            let inner_start = m.end();
            let full_end = inner_start + endif_pos + endif_tag.len();
            let span = full_end - m.start();
            let is_smaller = innermost
                .as_ref()
                .map_or(true, |prev| span < prev.full_end - prev.full_start);
            if is_smaller {
                innermost = Some(CondMatch {
                    full_start: m.start(),
                    inner_start,
                    inner_end: inner_start + endif_pos,
                    full_end,
                    path: p.to_string(),
                });
            }
        }
    }

    let cm = innermost?;
    let inner = &input[cm.inner_start..cm.inner_end];

    let replacement = match resolve(&cm.path, data) {
        Some(v) if is_truthy(v) => inner.to_string(),
        _ => String::new(),
    };

    let mut out = String::with_capacity(input.len());
    out.push_str(&input[..cm.full_start]);
    out.push_str(&replacement);
    out.push_str(&input[cm.full_end..]);
    Some(out)
}

pub fn inject(template: &str, data: &Value) -> String {
    // 1. Conditionals (process innermost first, loop until none remain)
    let mut result = template.to_string();
    while let Some(replaced) = replace_one_conditional(&result, data) {
        result = replaced;
    }

    // 2. Attributes (two-phase)
    let mut attrs: Vec<(String, String, String)> = Vec::new();
    let mut attr_idx = 0usize;
    result = ATTR_RE
        .replace_all(&result, |caps: &regex::Captures| {
            let path = &caps[1];
            let attr_name = caps[2].to_string();
            match resolve(path, data) {
                Some(v) => {
                    let marker = format!("\x00SEAM_ATTR_{}\x00", attr_idx);
                    attr_idx += 1;
                    attrs.push((marker.clone(), attr_name, escape_html(&stringify(v))));
                    marker
                }
                None => String::new(),
            }
        })
        .into_owned();

    for (marker, attr_name, value) in &attrs {
        if let Some(pos) = result.find(marker.as_str()) {
            result = format!("{}{}", &result[..pos], &result[pos + marker.len()..]);
            // Find next opening tag after marker position
            if let Some(tag_start) = result[pos..].find('<') {
                let abs_start = pos + tag_start;
                // Find end of tag name
                let mut tag_name_end = abs_start + 1;
                let bytes = result.as_bytes();
                while tag_name_end < bytes.len()
                    && bytes[tag_name_end] != b' '
                    && bytes[tag_name_end] != b'>'
                    && bytes[tag_name_end] != b'/'
                    && bytes[tag_name_end] != b'\n'
                    && bytes[tag_name_end] != b'\t'
                {
                    tag_name_end += 1;
                }
                let injection = format!(r#" {}="{}""#, attr_name, value);
                result = format!(
                    "{}{}{}",
                    &result[..tag_name_end],
                    injection,
                    &result[tag_name_end..]
                );
            }
        }
    }

    // 3. Raw HTML
    result = RAW_RE
        .replace_all(&result, |caps: &regex::Captures| {
            let path = &caps[1];
            match resolve(path, data) {
                Some(v) => stringify(v),
                None => String::new(),
            }
        })
        .into_owned();

    // 4. Text (escaped)
    result = TEXT_RE
        .replace_all(&result, |caps: &regex::Captures| {
            let path = &caps[1];
            match resolve(path, data) {
                Some(v) => escape_html(&stringify(v)),
                None => String::new(),
            }
        })
        .into_owned();

    // 5. __SEAM_DATA__ script
    let script = format!(
        r#"<script id="__SEAM_DATA__" type="application/json">{}</script>"#,
        data
    );
    if let Some(pos) = result.rfind("</body>") {
        result.insert_str(pos, &script);
    } else {
        result.push_str(&script);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn text_slot_basic() {
        let html = inject("<p><!--seam:name--></p>", &json!({"name": "Alice"}));
        assert!(html.contains("<p>Alice</p>"));
    }

    #[test]
    fn text_slot_escapes_html() {
        let html = inject(
            "<p><!--seam:msg--></p>",
            &json!({"msg": "<script>alert(\"xss\")</script>"}),
        );
        assert!(html.contains("<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>"));
    }

    #[test]
    fn text_slot_nested_path() {
        let html = inject(
            "<p><!--seam:user.address.city--></p>",
            &json!({"user": {"address": {"city": "Tokyo"}}}),
        );
        assert!(html.contains("<p>Tokyo</p>"));
    }

    #[test]
    fn text_slot_missing_path() {
        let html = inject("<p><!--seam:missing--></p>", &json!({}));
        assert!(html.contains("<p></p>"));
    }

    #[test]
    fn text_slot_number() {
        let html = inject("<p><!--seam:count--></p>", &json!({"count": 42}));
        assert!(html.contains("<p>42</p>"));
    }

    #[test]
    fn raw_slot() {
        let html = inject(
            "<div><!--seam:content:html--></div>",
            &json!({"content": "<b>bold</b>"}),
        );
        assert!(html.contains("<div><b>bold</b></div>"));
    }

    #[test]
    fn attr_slot() {
        let html = inject(
            "<!--seam:cls:attr:class--><div>hi</div>",
            &json!({"cls": "active"}),
        );
        assert!(html.contains(r#"<div class="active">hi</div>"#));
    }

    #[test]
    fn attr_slot_escapes_value() {
        let html = inject(
            "<!--seam:v:attr:title--><span>x</span>",
            &json!({"v": "a\"b"}),
        );
        assert!(html.contains(r#"<span title="a&quot;b">x</span>"#));
    }

    #[test]
    fn attr_slot_missing_skips() {
        let html = inject(
            "<!--seam:missing:attr:class--><div>hi</div>",
            &json!({}),
        );
        assert!(html.contains("<div>hi</div>"));
    }

    #[test]
    fn cond_truthy() {
        let html = inject(
            "<!--seam:if:show--><p>visible</p><!--seam:endif:show-->",
            &json!({"show": true}),
        );
        assert!(html.contains("<p>visible</p>"));
    }

    #[test]
    fn cond_falsy_bool() {
        let html = inject(
            "<!--seam:if:show--><p>hidden</p><!--seam:endif:show-->",
            &json!({"show": false}),
        );
        assert!(!html.contains("<p>hidden</p>"));
    }

    #[test]
    fn cond_falsy_null() {
        let html = inject(
            "<!--seam:if:show--><p>hidden</p><!--seam:endif:show-->",
            &json!({"show": null}),
        );
        assert!(!html.contains("<p>hidden</p>"));
    }

    #[test]
    fn cond_falsy_zero() {
        let html = inject(
            "<!--seam:if:count--><p>has</p><!--seam:endif:count-->",
            &json!({"count": 0}),
        );
        assert!(!html.contains("<p>has</p>"));
    }

    #[test]
    fn cond_falsy_empty_string() {
        let html = inject(
            "<!--seam:if:name--><p>hi</p><!--seam:endif:name-->",
            &json!({"name": ""}),
        );
        assert!(!html.contains("<p>hi</p>"));
    }

    #[test]
    fn cond_missing_removes() {
        let html = inject(
            "<!--seam:if:missing--><p>gone</p><!--seam:endif:missing-->",
            &json!({}),
        );
        assert!(!html.contains("<p>gone</p>"));
    }

    #[test]
    fn cond_nested_different_paths() {
        let tmpl =
            "<!--seam:if:a-->[<!--seam:if:b-->inner<!--seam:endif:b-->]<!--seam:endif:a-->";
        let html = inject(tmpl, &json!({"a": true, "b": true}));
        assert!(html.contains("[inner]"));

        let html2 = inject(tmpl, &json!({"a": true, "b": false}));
        assert!(html2.contains("[]"));

        let html3 = inject(tmpl, &json!({"a": false, "b": true}));
        assert!(!html3.contains("["));
    }

    #[test]
    fn data_script_before_body() {
        let html = inject("<body><p>hi</p></body>", &json!({"x": 1}));
        assert!(html.contains(
            r#"<script id="__SEAM_DATA__" type="application/json">{"x":1}</script></body>"#
        ));
    }

    #[test]
    fn data_script_appended_when_no_body() {
        let html = inject("<p>hi</p>", &json!({"x": 1}));
        assert!(html.ends_with(r#"<script id="__SEAM_DATA__" type="application/json">{"x":1}</script>"#));
    }
}
