/* packages/server/core/rust-macros/src/seam_subscription.rs */

use proc_macro2::TokenStream;
use quote::quote;
use syn::parse::{Parse, ParseStream};
use syn::{FnArg, ItemFn, LitStr, Pat, ReturnType, Token, Type};

struct SubscriptionAttr {
  name: Option<String>,
}

impl Parse for SubscriptionAttr {
  fn parse(input: ParseStream) -> syn::Result<Self> {
    if input.is_empty() {
      return Ok(SubscriptionAttr { name: None });
    }
    let ident: syn::Ident = input.parse()?;
    if ident != "name" {
      return Err(syn::Error::new_spanned(ident, "expected `name`"));
    }
    input.parse::<Token![=]>()?;
    let lit: LitStr = input.parse()?;
    Ok(SubscriptionAttr { name: Some(lit.value()) })
  }
}

pub fn expand(attr: TokenStream, item: ItemFn) -> syn::Result<TokenStream> {
  let parsed_attr: SubscriptionAttr = syn::parse2(attr)?;

  let fn_name = &item.sig.ident;
  let factory_name = syn::Ident::new(&format!("{}_subscription", fn_name), fn_name.span());

  let input_type = extract_input_type(&item)?;
  let output_type = extract_output_type(&item)?;
  let name_str = parsed_attr.name.unwrap_or_else(|| fn_name.to_string());

  Ok(quote! {
    #item

    pub fn #factory_name() -> seam_server::SubscriptionDef {
      seam_server::SubscriptionDef {
        name: #name_str.to_string(),
        input_schema: <#input_type as seam_server::SeamType>::jtd_schema(),
        output_schema: <#output_type as seam_server::SeamType>::jtd_schema(),
        error_schema: None,
        handler: std::sync::Arc::new(|value: serde_json::Value| {
          Box::pin(async move {
            let input: #input_type = serde_json::from_value(value)
              .map_err(|e| seam_server::SeamError::validation(e.to_string()))?;
            let stream = #fn_name(input).await?;
            Ok(stream)
          })
        }),
      }
    }
  })
}

fn extract_input_type(item: &ItemFn) -> syn::Result<Type> {
  let arg = item.sig.inputs.first().ok_or_else(|| {
    syn::Error::new_spanned(&item.sig, "subscription must have exactly one input parameter")
  })?;

  match arg {
    FnArg::Typed(pat_type) => {
      if let Pat::Ident(_) = &*pat_type.pat {
        Ok((*pat_type.ty).clone())
      } else {
        Err(syn::Error::new_spanned(&pat_type.pat, "expected a simple identifier pattern"))
      }
    }
    FnArg::Receiver(_) => Err(syn::Error::new_spanned(arg, "subscription cannot take self")),
  }
}

fn extract_output_type(item: &ItemFn) -> syn::Result<Type> {
  match &item.sig.output {
    ReturnType::Type(_, ty) => {
      // Expect Result<BoxStream<Result<OutputType, SeamError>>, SeamError>
      // We need to dig through: Result -> BoxStream -> Result -> OutputType
      if let Some(inner) = extract_first_generic_arg(ty) {
        if let Some(stream_inner) = extract_first_generic_arg(&inner) {
          if let Some(output) = extract_first_generic_arg(&stream_inner) {
            return Ok(output);
          }
          // If BoxStream<Result<T, E>>, stream_inner is Result<T, E>, extract T
          return Ok(stream_inner);
        }
        // Fallback: use inner directly
        return Ok(inner);
      }
      Ok((**ty).clone())
    }
    ReturnType::Default => {
      Err(syn::Error::new_spanned(&item.sig, "subscription must have a return type"))
    }
  }
}

fn extract_first_generic_arg(ty: &Type) -> Option<Type> {
  if let Type::Path(tp) = ty {
    if let Some(seg) = tp.path.segments.last() {
      if let syn::PathArguments::AngleBracketed(args) = &seg.arguments {
        if let Some(syn::GenericArgument::Type(inner)) = args.args.first() {
          return Some(inner.clone());
        }
      }
    }
  }
  None
}
