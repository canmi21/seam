/* src/cli/skeleton/src/document.rs */

use crate::ViteDevInfo;

const LIVE_RELOAD_SCRIPT: &str = concat!(
  r#"<script>(function(){var ws,t;function c(){"#,
  r#"ws=new WebSocket((location.protocol==="https:"?"wss:":"ws:")"#,
  r#"+"//"+location.host+"/_seam/dev/ws");"#,
  r#"ws.onmessage=function(){location.reload()};"#,
  r#"ws.onclose=function(){t=setTimeout(c,1000)}}c()})()</script>"#
);

/// Extract leading metadata elements (title, meta, link) and their surrounding
/// comment directives from the skeleton. Returns (head_metadata, remaining_body).
///
/// Comments are consumed speculatively; only actual metadata elements (title,
/// meta, link) advance the "confirmed" boundary. If comments precede a
/// non-metadata element (e.g. `<!--seam:cls:attr:class--><div>`), they stay
/// with the body. After the last metadata element, trailing `<!--seam:endif:*-->`
/// and `<!--seam:else-->` directives are included to keep if/endif pairs intact.
pub fn extract_head_metadata(skeleton: &str) -> (&str, &str) {
  let bytes = skeleton.as_bytes();
  let len = bytes.len();
  let mut pos = 0;
  let mut confirmed = 0; // end of last confirmed metadata element

  while pos < len {
    if bytes[pos].is_ascii_whitespace() {
      pos += 1;
      continue;
    }
    if bytes[pos] != b'<' {
      break;
    }

    // Comments: consume speculatively (don't advance `confirmed`)
    if skeleton[pos..].starts_with("<!--") {
      match skeleton[pos..].find("-->") {
        Some(end) => {
          pos += end + 3;
          continue;
        }
        None => break,
      }
    }

    // Metadata elements: consume and confirm
    if skeleton[pos..].starts_with("<title") {
      match skeleton[pos..].find("</title>") {
        Some(end) => {
          pos += end + 8;
          confirmed = pos;
          continue;
        }
        None => break,
      }
    }
    if skeleton[pos..].starts_with("<meta") {
      match skeleton[pos..].find('>') {
        Some(end) => {
          pos += end + 1;
          confirmed = pos;
          continue;
        }
        None => break,
      }
    }
    if skeleton[pos..].starts_with("<link") {
      match skeleton[pos..].find('>') {
        Some(end) => {
          pos += end + 1;
          confirmed = pos;
          continue;
        }
        None => break,
      }
    }

    break;
  }

  // Include trailing endif/else directives that pair with consumed if directives
  if confirmed > 0 {
    let mut trail = confirmed;
    while trail < len {
      while trail < len && bytes[trail].is_ascii_whitespace() {
        trail += 1;
      }
      if trail >= len {
        break;
      }
      let rest = &skeleton[trail..];
      if rest.starts_with("<!--seam:end") || rest.starts_with("<!--seam:else") {
        match rest.find("-->") {
          Some(end) => {
            trail += end + 3;
            continue;
          }
          None => break,
        }
      }
      break;
    }
    confirmed = trail;
  }

  (&skeleton[..confirmed], &skeleton[confirmed..])
}

/// Wrap a skeleton HTML fragment in a compact HTML5 document with asset references.
/// Produces minimal single-line output for production templates.
/// When `dev_mode` is true, injects a live reload WebSocket script before `</body>`.
/// When `vite` is Some, replaces static CSS/JS refs with Vite dev server scripts.
pub fn wrap_document(
  skeleton: &str,
  css_files: &[String],
  js_files: &[String],
  dev_mode: bool,
  vite: Option<&ViteDevInfo>,
  root_id: &str,
) -> String {
  let mut doc = String::from("<!DOCTYPE html><html><head><meta charset=\"utf-8\">");
  if let Some(v) = vite {
    // React Fast Refresh preamble
    doc.push_str(&format!(
      concat!(
        "<script type=\"module\">",
        "import RefreshRuntime from '{origin}/@react-refresh';",
        "RefreshRuntime.injectIntoGlobalHook(window);",
        "window.$RefreshReg$ = () => {{}};",
        "window.$RefreshSig$ = () => (type) => type;",
        "window.__vite_plugin_react_preamble_installed__ = true",
        "</script>"
      ),
      origin = v.origin,
    ));
    // Vite HMR client
    doc.push_str(&format!(
      r#"<script type="module" src="{origin}/@vite/client"></script>"#,
      origin = v.origin,
    ));
    // App entry
    doc.push_str(&format!(
      r#"<script type="module" src="{origin}/{entry}"></script>"#,
      origin = v.origin,
      entry = v.entry,
    ));
  } else {
    for f in css_files {
      doc.push_str(&format!(r#"<link rel="stylesheet" href="/_seam/static/{f}">"#));
    }
  }
  let (head_meta, body_skeleton) = extract_head_metadata(skeleton);
  if !head_meta.is_empty() {
    doc.push_str(head_meta);
  }
  doc.push_str(&format!("</head><body><div id=\"{root_id}\">"));
  doc.push_str(body_skeleton);
  doc.push_str("</div>");
  if vite.is_none() {
    for f in js_files {
      doc.push_str(&format!(r#"<script type="module" src="/_seam/static/{f}"></script>"#));
    }
  }
  if dev_mode && vite.is_none() {
    doc.push_str(LIVE_RELOAD_SCRIPT);
  }
  doc.push_str("</body></html>");
  doc
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn wraps_with_assets() {
    let result = wrap_document(
      "<p>Hello</p>",
      &["style-abc.css".into()],
      &["main-xyz.js".into()],
      false,
      None,
      "__seam",
    );
    assert_eq!(
      result,
      concat!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\">",
        "<link rel=\"stylesheet\" href=\"/_seam/static/style-abc.css\">",
        "</head><body>",
        "<div id=\"__seam\"><p>Hello</p></div>",
        "<script type=\"module\" src=\"/_seam/static/main-xyz.js\"></script>",
        "</body></html>"
      )
    );
  }

  #[test]
  fn wraps_without_assets() {
    let result = wrap_document("<p>Hi</p>", &[], &[], false, None, "__seam");
    assert_eq!(
      result,
      concat!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\">",
        "</head><body>",
        "<div id=\"__seam\"><p>Hi</p></div>",
        "</body></html>"
      )
    );
  }

  #[test]
  fn wraps_with_hoisted_metadata() {
    let skeleton =
      "<title><!--seam:t--></title><!--seam:d:attr:content--><meta name=\"desc\"><p>content</p>";
    let result = wrap_document(skeleton, &["style.css".into()], &[], false, None, "__seam");

    let head = result.split("</head>").next().unwrap();
    assert!(head.contains("<title><!--seam:t--></title>"), "title must be in <head>");
    assert!(head.contains("<!--seam:d:attr:content-->"), "meta slot marker must be in <head>");
    assert!(head.contains("<meta name=\"desc\">"), "meta element must be in <head>");
    assert!(head.contains("style.css"));

    let root_start = result.find("__seam").unwrap();
    let root_section = &result[root_start..];
    assert!(!root_section.contains("<title>"), "title must not be in root div");
    assert!(root_section.contains("<p>content</p>"), "body content stays in root div");
  }

  #[test]
  fn wraps_with_link_in_skeleton() {
    let skeleton = "<!--seam:u:attr:href--><link rel=\"canonical\"><p>page</p>";
    let result = wrap_document(skeleton, &["app.css".into()], &[], false, None, "__seam");

    let head = result.split("</head>").next().unwrap();
    assert!(head.contains("app.css"));
    assert!(head.contains("<!--seam:u:attr:href-->"), "link slot marker must be in <head>");
    assert!(head.contains("rel=\"canonical\""), "link element must be in <head>");

    let body = result.split("__seam").nth(1).unwrap();
    assert!(body.contains("<p>page</p>"), "body content stays in root div");
    assert!(!body.contains("<link"), "link must not be in root div");
  }

  #[test]
  fn dev_mode_injects_live_reload_script() {
    let result = wrap_document("<p>dev</p>", &[], &["app.js".into()], true, None, "__seam");
    assert!(result.contains("WebSocket"), "dev_mode should inject WebSocket live reload");
    assert!(result.contains("/_seam/dev/ws"));
    let script_pos = result.find("WebSocket").unwrap();
    let module_pos = result.find("app.js").unwrap();
    let body_end = result.find("</body>").unwrap();
    assert!(script_pos > module_pos);
    assert!(script_pos < body_end);
  }

  #[test]
  fn production_mode_no_reload_script() {
    let result = wrap_document("<p>prod</p>", &[], &["app.js".into()], false, None, "__seam");
    assert!(!result.contains("WebSocket"), "production mode must not inject live reload");
  }

  #[test]
  fn vite_mode_injects_three_scripts() {
    let vite = ViteDevInfo {
      origin: "http://localhost:5173".to_string(),
      entry: "src/client/main.tsx".to_string(),
    };
    let result = wrap_document(
      "<p>vite</p>",
      &["ignored.css".into()],
      &["ignored.js".into()],
      false,
      Some(&vite),
      "__seam",
    );

    // All three Vite scripts present
    assert!(result.contains("@react-refresh"), "must inject React Refresh preamble");
    assert!(result.contains("/@vite/client"), "must inject Vite HMR client");
    assert!(result.contains("src/client/main.tsx"), "must inject app entry");

    // No static asset references
    assert!(!result.contains("/_seam/static/"), "vite mode must not reference static assets");
    assert!(!result.contains("ignored.css"));
    assert!(!result.contains("ignored.js"));
  }

  #[test]
  fn vite_mode_skips_websocket_reload() {
    let vite = ViteDevInfo {
      origin: "http://localhost:5173".to_string(),
      entry: "src/client/main.tsx".to_string(),
    };
    let result = wrap_document("<p>vite-dev</p>", &[], &[], true, Some(&vite), "__seam");

    // Vite scripts present
    assert!(result.contains("/@vite/client"));
    // WebSocket live reload must NOT be injected — Vite HMR handles reload
    assert!(!result.contains("/_seam/dev/ws"), "vite mode must not inject WebSocket reload");
  }

  #[test]
  fn no_metadata_passes_through() {
    let result = wrap_document("<div><p>Hello</p></div>", &[], &[], false, None, "__seam");
    assert!(result.contains("<div id=\"__seam\"><div><p>Hello</p></div></div>"));
  }

  #[test]
  fn conditional_metadata_extracted() {
    let skeleton =
      "<!--seam:if:x--><!--seam:d:attr:content--><meta name=\"og\"><!--seam:endif:x--><p>body</p>";
    let result = wrap_document(skeleton, &[], &[], false, None, "__seam");

    let head = result.split("</head>").next().unwrap();
    assert!(head.contains("<!--seam:if:x-->"), "conditional directive in <head>");
    assert!(head.contains("<meta name=\"og\">"), "meta in <head>");
    assert!(head.contains("<!--seam:endif:x-->"), "endif directive in <head>");

    let root_start = result.find("__seam").unwrap();
    let root_section = &result[root_start..];
    assert!(root_section.contains("<p>body</p>"), "body content in root div");
    assert!(!root_section.contains("<meta"), "meta not in root div");
  }
}
