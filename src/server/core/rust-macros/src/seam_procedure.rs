/* src/server/core/rust-macros/src/seam_procedure.rs */

use proc_macro2::TokenStream;
use quote::quote;
use syn::parse::{Parse, ParseStream};
use syn::{FnArg, ItemFn, LitStr, Pat, ReturnType, Token, Type};

pub(crate) struct ProcedureAttr {
  pub name: Option<String>,
  pub error: Option<syn::Path>,
}

impl Parse for ProcedureAttr {
  fn parse(input: ParseStream) -> syn::Result<Self> {
    let mut name = None;
    let mut error = None;

    while !input.is_empty() {
      let ident: syn::Ident = input.parse()?;
      if ident == "name" {
        input.parse::<Token![=]>()?;
        let lit: LitStr = input.parse()?;
        name = Some(lit.value());
      } else if ident == "error" {
        input.parse::<Token![=]>()?;
        error = Some(input.parse::<syn::Path>()?);
      } else {
        return Err(syn::Error::new_spanned(ident, "expected `name` or `error`"));
      }
      // consume optional trailing comma
      let _ = input.parse::<Token![,]>();
    }

    Ok(ProcedureAttr { name, error })
  }
}

pub fn expand(attr: TokenStream, item: ItemFn) -> syn::Result<TokenStream> {
  let parsed_attr: ProcedureAttr = syn::parse2(attr)?;
  expand_with_type(parsed_attr, item, quote! { seam_server::ProcedureType::Query })
}

/// Shared codegen for both `seam_procedure` (Query) and `seam_command` (Command).
pub(crate) fn expand_with_type(
  attr: ProcedureAttr,
  item: ItemFn,
  proc_type_token: TokenStream,
) -> syn::Result<TokenStream> {
  let fn_name = &item.sig.ident;
  let factory_name = syn::Ident::new(&format!("{}_procedure", fn_name), fn_name.span());

  let input_type = extract_input_type(&item)?;
  let output_type = extract_output_type(&item)?;
  let name_str = attr.name.unwrap_or_else(|| fn_name.to_string());

  let error_schema_expr = match attr.error {
    Some(path) => quote! { Some(<#path as seam_server::SeamType>::jtd_schema()) },
    None => quote! { None },
  };

  let handler_body = quote! {
    std::sync::Arc::new(|value: serde_json::Value| {
      Box::pin(async move {
        let input: #input_type = serde_json::from_value(value)
          .map_err(|e| seam_server::SeamError::validation(e.to_string()))?;
        let output = #fn_name(input).await?;
        serde_json::to_value(output)
          .map_err(|e| seam_server::SeamError::internal(e.to_string()))
      })
    })
  };

  Ok(quote! {
    #item

    pub fn #factory_name() -> seam_server::ProcedureDef {
      seam_server::ProcedureDef {
        name: #name_str.to_string(),
        proc_type: #proc_type_token,
        input_schema: <#input_type as seam_server::SeamType>::jtd_schema(),
        output_schema: <#output_type as seam_server::SeamType>::jtd_schema(),
        error_schema: #error_schema_expr,
        handler: #handler_body,
      }
    }
  })
}

pub(crate) fn extract_input_type(item: &ItemFn) -> syn::Result<Type> {
  let arg = item.sig.inputs.first().ok_or_else(|| {
    syn::Error::new_spanned(&item.sig, "procedure must have exactly one input parameter")
  })?;

  match arg {
    FnArg::Typed(pat_type) => {
      // Allow `_input: Type` or `input: Type`
      if let Pat::Ident(_) = &*pat_type.pat {
        Ok((*pat_type.ty).clone())
      } else {
        Err(syn::Error::new_spanned(&pat_type.pat, "expected a simple identifier pattern"))
      }
    }
    FnArg::Receiver(_) => Err(syn::Error::new_spanned(arg, "procedure cannot take self")),
  }
}

pub(crate) fn extract_output_type(item: &ItemFn) -> syn::Result<Type> {
  match &item.sig.output {
    ReturnType::Type(_, ty) => {
      // Expect Result<OutputType, SeamError> — extract the first generic arg
      if let Type::Path(tp) = ty.as_ref() {
        if let Some(seg) = tp.path.segments.last() {
          if let syn::PathArguments::AngleBracketed(args) = &seg.arguments {
            if let Some(syn::GenericArgument::Type(inner)) = args.args.first() {
              return Ok(inner.clone());
            }
          }
        }
      }
      // Fallback: use the whole return type
      Ok((**ty).clone())
    }
    ReturnType::Default => {
      Err(syn::Error::new_spanned(&item.sig, "procedure must have a return type"))
    }
  }
}
