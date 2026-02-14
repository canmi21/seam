use proc_macro2::TokenStream;
use quote::quote;
use syn::{FnArg, ItemFn, Pat, ReturnType, Type};

pub fn expand(attr: TokenStream, item: ItemFn) -> syn::Result<TokenStream> {
  if !attr.is_empty() {
    return Err(syn::Error::new_spanned(attr, "#[seam_procedure] does not accept arguments"));
  }

  let fn_name = &item.sig.ident;
  let factory_name = syn::Ident::new(&format!("{}_procedure", fn_name), fn_name.span());

  let input_type = extract_input_type(&item)?;
  let output_type = extract_output_type(&item)?;
  let name_str = fn_name.to_string();

  // Emit original fn + a factory fn that returns ProcedureDef
  Ok(quote! {
    #item

    pub fn #factory_name() -> seam_server::ProcedureDef {
      seam_server::ProcedureDef {
        name: #name_str.to_string(),
        input_schema: <#input_type as seam_server::SeamType>::jtd_schema(),
        output_schema: <#output_type as seam_server::SeamType>::jtd_schema(),
        handler: std::sync::Arc::new(|value: serde_json::Value| {
          Box::pin(async move {
            let input: #input_type = serde_json::from_value(value)
              .map_err(|e| seam_server::SeamError::validation(e.to_string()))?;
            let output = #fn_name(input).await?;
            serde_json::to_value(output)
              .map_err(|e| seam_server::SeamError::internal(e.to_string()))
          })
        }),
      }
    }
  })
}

fn extract_input_type(item: &ItemFn) -> syn::Result<Type> {
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

fn extract_output_type(item: &ItemFn) -> syn::Result<Type> {
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
