/* packages/server/core/rust-macros/src/seam_type.rs */

use proc_macro2::TokenStream;
use quote::quote;
use syn::{Data, DeriveInput, Fields, Type};

pub fn expand(input: DeriveInput) -> syn::Result<TokenStream> {
  let name = &input.ident;
  let (impl_generics, ty_generics, where_clause) = input.generics.split_for_impl();

  let body = match &input.data {
    Data::Struct(data) => expand_struct(&data.fields)?,
    Data::Enum(data) => expand_enum(data)?,
    _ => {
      return Err(syn::Error::new_spanned(
        &input.ident,
        "SeamType can only be derived for structs and enums",
      ));
    }
  };

  Ok(quote! {
    impl #impl_generics seam_server::SeamType for #name #ty_generics #where_clause {
      fn jtd_schema() -> serde_json::Value {
        #body
      }
    }
  })
}

fn expand_enum(data: &syn::DataEnum) -> syn::Result<TokenStream> {
  let mut values = Vec::new();
  for variant in &data.variants {
    if !variant.fields.is_empty() {
      return Err(syn::Error::new_spanned(
        variant,
        "SeamType enum derive only supports unit variants (no fields)",
      ));
    }
    let name = variant.ident.to_string().to_lowercase();
    values.push(name);
  }

  Ok(quote! {
    serde_json::json!({ "enum": [#(#values),*] })
  })
}

fn expand_struct(fields: &Fields) -> syn::Result<TokenStream> {
  let named = match fields {
    Fields::Named(f) => f,
    _ => {
      return Err(syn::Error::new_spanned(fields, "SeamType requires named fields"));
    }
  };

  let mut required_inserts = Vec::new();
  let mut optional_inserts = Vec::new();

  for field in &named.named {
    let field_name = field.ident.as_ref().unwrap();
    let key = field_name.to_string();
    let ty = &field.ty;

    if is_option_type(ty) {
      let inner = extract_option_inner(ty)
        .ok_or_else(|| syn::Error::new_spanned(ty, "could not extract inner type from Option"))?;
      // Optional fields use nullable wrapping
      optional_inserts.push(quote! {
        let mut schema = <#inner as seam_server::SeamType>::jtd_schema();
        if let Some(obj) = schema.as_object_mut() {
          obj.insert("nullable".to_string(), serde_json::Value::Bool(true));
        }
        opt_props.insert(#key.to_string(), schema);
      });
    } else {
      required_inserts.push(quote! {
        props.insert(
          #key.to_string(),
          <#ty as seam_server::SeamType>::jtd_schema(),
        );
      });
    }
  }

  Ok(quote! {
    let mut props = serde_json::Map::new();
    let mut opt_props = serde_json::Map::new();
    #(#required_inserts)*
    #(#optional_inserts)*

    let mut schema = serde_json::Map::new();
    schema.insert("properties".to_string(), serde_json::Value::Object(props));
    if !opt_props.is_empty() {
      schema.insert("optionalProperties".to_string(), serde_json::Value::Object(opt_props));
    }
    serde_json::Value::Object(schema)
  })
}

fn is_option_type(ty: &Type) -> bool {
  if let Type::Path(tp) = ty {
    if let Some(seg) = tp.path.segments.last() {
      return seg.ident == "Option";
    }
  }
  false
}

fn extract_option_inner(ty: &Type) -> Option<&Type> {
  if let Type::Path(tp) = ty {
    if let Some(seg) = tp.path.segments.last() {
      if seg.ident == "Option" {
        if let syn::PathArguments::AngleBracketed(args) = &seg.arguments {
          if let Some(syn::GenericArgument::Type(inner)) = args.args.first() {
            return Some(inner);
          }
        }
      }
    }
  }
  None
}
