/* src/cli/core/src/build/skeleton/extract/tests/regression.rs */

// HomeSkeleton regression, comprehensive all-child-types, and edge case tests.

use super::*;

// -- HomeSkeleton regression: exercises all 4 extraction bugs --

#[test]
fn extract_home_skeleton_regression() {
  let axes = vec![
    make_axis("isLoggedIn", "boolean", vec![json!(true), json!(false)]),
    make_axis("posts", "array", vec![json!("populated"), json!("empty")]),
    make_axis("posts.$.isPublished", "boolean", vec![json!(true), json!(false)]),
    make_axis("posts.$.priority", "enum", vec![json!("high"), json!("medium"), json!("low")]),
  ];

  fn make(logged_in: bool, posts_pop: bool, published: bool, priority: &str) -> String {
    let status = if logged_in {
      r#"<p class="text-green">Signed in</p>"#
    } else {
      r#"<p class="text-gray">Please sign in</p>"#
    };
    let posts_html = if posts_pop {
      let border = match priority {
        "high" => "border-red",
        "medium" => "border-amber",
        _ => "border-gray",
      };
      let pri_label = match priority {
        "high" => "High",
        "medium" => "Medium",
        _ => "Low",
      };
      let pub_html = if published { "<span>Published</span>" } else { "" };
      format!(
        r#"<ul class="list"><li class="{border}"><!--seam:posts.$.title-->{pub_html}<span>Priority: {pri_label}</span></li></ul>"#
      )
    } else {
      "<p>No posts</p>".to_string()
    };
    format!("<div>{status}{posts_html}</div>")
  }

  let mut variants = Vec::new();
  for &logged_in in &[true, false] {
    for &posts_pop in &[true, false] {
      for &published in &[true, false] {
        for priority in &["high", "medium", "low"] {
          variants.push(make(logged_in, posts_pop, published, priority));
        }
      }
    }
  }

  let result = extract_template(&axes, &variants);

  // Bug 4: diff boundary must not split inside class attribute
  assert!(
    !result.contains(r#"class="text-<!--seam:"#),
    "Bug 4: diff split inside class attribute in:\n{result}"
  );

  // Bug 1: <ul> must NOT be inside the each loop
  assert!(
    !result.contains("<!--seam:each:posts--><ul"),
    "Bug 1: container duplicated inside each loop in:\n{result}"
  );

  // Bug 2: all seam comments must be well-formed
  for (i, _) in result.match_indices("-seam:endif") {
    assert!(
      i >= 3 && &result[i - 3..i] == "<!-",
      "Bug 2: malformed endif comment at byte {i} in:\n{result}"
    );
  }

  // Bug 3: no stale content leaking after endmatch
  if let Some(after) = result.split("<!--seam:endmatch-->").nth(1) {
    let before_next_tag = after.split('<').next().unwrap_or("");
    assert!(
      !before_next_tag.contains("Priority:"),
      "Bug 3: stale content after endmatch in:\n{result}"
    );
  }

  // Positive structural assertions
  assert!(result.contains("<!--seam:if:isLoggedIn-->"), "missing if:isLoggedIn in:\n{result}");
  assert!(result.contains("<!--seam:else-->"), "missing else in:\n{result}");
  assert!(
    result.contains("<!--seam:endif:isLoggedIn-->"),
    "missing endif:isLoggedIn in:\n{result}"
  );
  assert!(result.contains("<!--seam:if:posts-->"), "missing if:posts in:\n{result}");
  assert!(result.contains("<!--seam:each:posts-->"), "missing each:posts in:\n{result}");
  assert!(result.contains("<!--seam:endeach-->"), "missing endeach in:\n{result}");
  assert!(result.contains("<p>No posts</p>"), "missing posts fallback in:\n{result}");
  assert!(result.contains("<!--seam:endif:posts-->"), "missing endif:posts in:\n{result}");
  assert!(
    result.contains("<!--seam:if:$.isPublished-->"),
    "missing if:$.isPublished in:\n{result}"
  );
  assert!(
    result.contains("<!--seam:endif:$.isPublished-->"),
    "missing endif:$.isPublished in:\n{result}"
  );
  assert!(
    result.contains("<!--seam:match:$.priority-->"),
    "missing match:$.priority in:\n{result}"
  );
  assert!(result.contains("<!--seam:when:high-->"), "missing when:high in:\n{result}");
  assert!(result.contains("<!--seam:endmatch-->"), "missing endmatch in:\n{result}");
  assert!(!result.contains("posts.$."), "leaked nested path in:\n{result}");
}

#[allow(clippy::too_many_arguments)]
fn gen_all_child_types(
  is_admin: bool,
  is_logged_in: bool,
  subtitle: bool,
  role: &str,
  pop: bool,
  published: bool,
  priority: &str,
  author: bool,
  tags: bool,
) -> String {
  let admin = if is_admin { "<span>Admin</span>" } else { "" };
  let status = if is_logged_in { "Signed in" } else { "Please sign in" };
  let sub = if subtitle { "<p><!--seam:subtitle--></p>" } else { "" };
  let role_html = match role {
    "admin" => "<span>Full access</span>",
    "member" => "<span>Member access</span>",
    _ => "<span>Read-only</span>",
  };
  let posts_html = if pop {
    let pub_html = if published { "<span>Published</span>" } else { "<span>Draft</span>" };
    let border = match priority {
      "high" => "border-red",
      "medium" => "border-amber",
      _ => "border-gray",
    };
    let author_html = if author { "<span>by <!--seam:posts.$.author--></span>" } else { "" };
    let tags_html = if tags { "<span><!--seam:posts.$.tags.$.name--></span>" } else { "" };
    format!(
      r#"<ul class="list"><li class="{border}"><!--seam:posts.$.title-->{pub_html}{author_html}<div>{tags_html}</div></li></ul>"#
    )
  } else {
    "<p>No posts</p>".to_string()
  };
  format!("<div>{admin}<p>{status}</p>{sub}{role_html}{posts_html}</div>")
}

#[test]
fn extract_array_with_all_child_types() {
  // Full home page scenario: top-level axes + posts array with 4 child axis types.
  let axes = vec![
    make_axis("isAdmin", "boolean", vec![json!(true), json!(false)]),
    make_axis("isLoggedIn", "boolean", vec![json!(true), json!(false)]),
    make_axis("subtitle", "nullable", vec![json!("present"), json!(null)]),
    make_axis("role", "enum", vec![json!("admin"), json!("member"), json!("guest")]),
    make_axis("posts", "array", vec![json!("populated"), json!("empty")]),
    make_axis("posts.$.isPublished", "boolean", vec![json!(true), json!(false)]),
    make_axis("posts.$.priority", "enum", vec![json!("high"), json!("medium"), json!("low")]),
    make_axis("posts.$.author", "nullable", vec![json!("present"), json!(null)]),
    make_axis("posts.$.tags", "array", vec![json!("populated"), json!("empty")]),
  ];

  let mut variants = Vec::new();
  for &is_admin in &[true, false] {
    for &is_logged_in in &[true, false] {
      for &subtitle in &[true, false] {
        for role in &["admin", "member", "guest"] {
          for &pop in &[true, false] {
            for &published in &[true, false] {
              for priority in &["high", "medium", "low"] {
                for &author in &[true, false] {
                  for &tags in &[true, false] {
                    variants.push(gen_all_child_types(
                      is_admin,
                      is_logged_in,
                      subtitle,
                      role,
                      pop,
                      published,
                      priority,
                      author,
                      tags,
                    ));
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  assert_eq!(variants.len(), 1152);
  let result = extract_template(&axes, &variants);

  // Container unwrap: <ul> must be OUTSIDE the each loop
  assert!(
    !result.contains("<!--seam:each:posts--><ul"),
    "container duplicated inside each loop in:\n{result}"
  );
  assert!(
    result.contains("<ul") && result.contains("<!--seam:each:posts-->"),
    "missing structure in:\n{result}"
  );
  // Array empty-state fallback
  assert!(result.contains("<!--seam:if:posts-->"), "missing if:posts in:\n{result}");
  assert!(result.contains("<p>No posts</p>"), "missing posts fallback in:\n{result}");
  assert!(result.contains("<!--seam:endif:posts-->"), "missing endif:posts in:\n{result}");
  // Top-level directives
  assert!(result.contains("<!--seam:if:isAdmin-->"), "missing isAdmin in:\n{result}");
  assert!(result.contains("<!--seam:if:isLoggedIn-->"), "missing isLoggedIn in:\n{result}");
  assert!(result.contains("<!--seam:if:subtitle-->"), "missing subtitle in:\n{result}");
  assert!(result.contains("<!--seam:match:role-->"), "missing role match in:\n{result}");
  // Nested directives
  assert!(result.contains("<!--seam:if:$.isPublished-->"), "missing isPublished in:\n{result}");
  assert!(result.contains("<!--seam:match:$.priority-->"), "missing priority match in:\n{result}");
  assert!(result.contains("<!--seam:if:$.author-->"), "missing author conditional in:\n{result}");
  assert!(result.contains("<!--seam:each:$.tags-->"), "missing tags each in:\n{result}");
  assert!(result.contains("<!--seam:endeach-->"), "missing endeach in:\n{result}");
  assert!(!result.contains("posts.$."), "leaked nested path in:\n{result}");

  // No doubled directives: role wraps everything (3 arms), $.priority inside each (3 arms).
  // Nested directives appear 3 x 3 = 9 times; top-level ones appear 3 times (once per role arm).
  assert_eq!(
    result.matches("<!--seam:each:$.tags-->").count(),
    9,
    "wrong each:$.tags count in:\n{result}"
  );
  assert_eq!(
    result.matches("<!--seam:if:$.author-->").count(),
    9,
    "wrong if:$.author count in:\n{result}"
  );
  assert_eq!(
    result.matches("<!--seam:if:subtitle-->").count(),
    3,
    "wrong if:subtitle count in:\n{result}"
  );
}

#[test]
fn extract_boolean_if_else_in_class_attribute() {
  let axes = vec![make_axis("dark", "boolean", vec![json!(true), json!(false)])];
  let variants = vec![
    r#"<div class="bg-black text-white">Dark</div>"#.to_string(),
    r#"<div class="bg-white text-black">Light</div>"#.to_string(),
  ];
  let result = extract_template(&axes, &variants);
  assert!(
    !result.contains(r#"class=""#) || !result.contains("<!--seam:if:dark-->text-"),
    "diff boundary inside class attribute in:\n{result}"
  );
  assert!(result.contains("<!--seam:if:dark-->"), "missing if in:\n{result}");
  assert!(result.contains("<!--seam:else-->"), "missing else in:\n{result}");
  assert!(result.contains("<!--seam:endif:dark-->"), "missing endif in:\n{result}");
}

#[test]
fn extract_array_container_unwrap() {
  let axes = vec![make_axis("items", "array", vec![json!("populated"), json!("empty")])];
  let variants = vec![
    r#"<div><ul class="list"><li><!--seam:items.$.name--></li></ul></div>"#.to_string(),
    r#"<div><p>No items</p></div>"#.to_string(),
  ];
  let result = extract_template(&axes, &variants);
  assert!(
    result.contains("<ul") && result.contains("<!--seam:each:items-->"),
    "missing structure in:\n{result}"
  );
  assert!(
    !result.contains("<!--seam:each:items--><ul"),
    "container inside each loop in:\n{result}"
  );
  // Empty-state fallback
  assert!(result.contains("<!--seam:if:items-->"), "missing if:items in:\n{result}");
  assert!(result.contains("<p>No items</p>"), "missing fallback in:\n{result}");
  assert!(result.contains("<!--seam:endif:items-->"), "missing endif:items in:\n{result}");
}

// -- Motivating bug: sibling boolean conditionals --

#[test]
fn extract_sibling_booleans() {
  let axes = vec![
    make_axis("isAdmin", "boolean", vec![json!(true), json!(false)]),
    make_axis("isLoggedIn", "boolean", vec![json!(true), json!(false)]),
  ];
  let variants = vec![
    "<div><span>Admin</span><span>Welcome</span></div>".into(), // TT
    "<div><span>Admin</span></div>".into(),                     // TF
    "<div><span>Welcome</span></div>".into(),                   // FT
    "<div></div>".into(),                                       // FF
  ];
  let result = extract_template(&axes, &variants);
  assert!(
    result.contains("<!--seam:if:isAdmin--><span>Admin</span><!--seam:endif:isAdmin-->"),
    "missing isAdmin conditional in:\n{result}"
  );
  assert!(
    result.contains("<!--seam:if:isLoggedIn--><span>Welcome</span><!--seam:endif:isLoggedIn-->"),
    "missing isLoggedIn conditional in:\n{result}"
  );
}
