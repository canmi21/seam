/* src/server/core/rust-macros/src/seam_upload.rs */

use proc_macro2::TokenStream;
use quote::quote;
use syn::parse::{Parse, ParseStream};
use syn::{ItemFn, LitStr, ReturnType, Token, Type};

use crate::seam_procedure::{ensure_arg_count, extract_typed_arg};

struct UploadAttr {
	name: Option<String>,
	error: Option<syn::Path>,
	context: Option<syn::Path>,
	state: Option<syn::Path>,
}

impl Parse for UploadAttr {
	fn parse(input: ParseStream) -> syn::Result<Self> {
		let mut name = None;
		let mut error = None;
		let mut context = None;
		let mut state = None;

		while !input.is_empty() {
			let ident: syn::Ident = input.parse()?;
			if ident == "name" {
				input.parse::<Token![=]>()?;
				let lit: LitStr = input.parse()?;
				name = Some(lit.value());
			} else if ident == "error" {
				input.parse::<Token![=]>()?;
				error = Some(input.parse::<syn::Path>()?);
			} else if ident == "context" {
				input.parse::<Token![=]>()?;
				context = Some(input.parse::<syn::Path>()?);
			} else if ident == "state" {
				input.parse::<Token![=]>()?;
				state = Some(input.parse::<syn::Path>()?);
			} else {
				return Err(syn::Error::new_spanned(
					ident,
					"expected `name`, `error`, `context`, or `state`",
				));
			}
			let _ = input.parse::<Token![,]>();
		}

		Ok(UploadAttr { name, error, context, state })
	}
}

#[allow(clippy::needless_pass_by_value)]
#[allow(clippy::too_many_lines)]
pub fn expand(attr: TokenStream, item: ItemFn) -> syn::Result<TokenStream> {
	let parsed_attr: UploadAttr = syn::parse2(attr)?;

	let fn_name = &item.sig.ident;
	let factory_name = syn::Ident::new(&format!("{fn_name}_upload"), fn_name.span());

	let input_type = extract_input_type(&item)?;
	let output_type = extract_output_type(&item)?;
	let name_str = parsed_attr.name.unwrap_or_else(|| fn_name.to_string());
	let expected_args =
		2 + usize::from(parsed_attr.context.is_some()) + usize::from(parsed_attr.state.is_some());
	ensure_arg_count(&item, expected_args, "upload")?;
	let factory_params = match parsed_attr.state.clone() {
		Some(state_path) => quote! { state: std::sync::Arc<#state_path> },
		None => quote! {},
	};

	let error_schema_expr = match parsed_attr.error {
		Some(path) => quote! { Some(<#path as seam_server::SeamType>::jtd_schema()) },
		None => quote! { None },
	};

	let (handler_body, context_keys_expr) = match (parsed_attr.context, parsed_attr.state) {
		(Some(ctx_path), Some(_state_path)) => {
			let handler = quote! {
				std::sync::Arc::new(
					move |value: serde_json::Value, file: seam_server::SeamFileHandle, ctx_value: serde_json::Value| {
						let state = std::sync::Arc::clone(&state);
						Box::pin(async move {
							let input: #input_type = serde_json::from_value(value)
								.map_err(|e| seam_server::SeamError::validation(e.to_string()))?;
							let ctx: #ctx_path = serde_json::from_value(ctx_value)
								.map_err(|e| seam_server::SeamError::context_error(e.to_string()))?;
							let output = #fn_name(input, file, ctx, &state).await?;
							serde_json::to_value(output)
								.map_err(|e| seam_server::SeamError::internal(e.to_string()))
						})
					},
				)
			};
			let keys = quote! {
				seam_server::context_keys_from_schema(
					&<#ctx_path as seam_server::SeamType>::jtd_schema()
				)
			};
			(handler, keys)
		}
		(Some(ctx_path), None) => {
			let handler = quote! {
				std::sync::Arc::new(|value: serde_json::Value, file: seam_server::SeamFileHandle, ctx_value: serde_json::Value| {
					Box::pin(async move {
						let input: #input_type = serde_json::from_value(value)
							.map_err(|e| seam_server::SeamError::validation(e.to_string()))?;
						let ctx: #ctx_path = serde_json::from_value(ctx_value)
							.map_err(|e| seam_server::SeamError::context_error(e.to_string()))?;
						let output = #fn_name(input, file, ctx).await?;
						serde_json::to_value(output)
							.map_err(|e| seam_server::SeamError::internal(e.to_string()))
					})
				})
			};
			let keys = quote! {
				seam_server::context_keys_from_schema(
					&<#ctx_path as seam_server::SeamType>::jtd_schema()
				)
			};
			(handler, keys)
		}
		(None, Some(_state_path)) => {
			let handler = quote! {
				std::sync::Arc::new(
					move |value: serde_json::Value, file: seam_server::SeamFileHandle, _ctx: serde_json::Value| {
						let state = std::sync::Arc::clone(&state);
						Box::pin(async move {
							let input: #input_type = serde_json::from_value(value)
								.map_err(|e| seam_server::SeamError::validation(e.to_string()))?;
							let output = #fn_name(input, file, &state).await?;
							serde_json::to_value(output)
								.map_err(|e| seam_server::SeamError::internal(e.to_string()))
						})
					},
				)
			};
			let keys = quote! { vec![] };
			(handler, keys)
		}
		(None, None) => {
			let handler = quote! {
				std::sync::Arc::new(|value: serde_json::Value, file: seam_server::SeamFileHandle, _ctx: serde_json::Value| {
					Box::pin(async move {
						let input: #input_type = serde_json::from_value(value)
							.map_err(|e| seam_server::SeamError::validation(e.to_string()))?;
						let output = #fn_name(input, file).await?;
						serde_json::to_value(output)
							.map_err(|e| seam_server::SeamError::internal(e.to_string()))
					})
				})
			};
			let keys = quote! { vec![] };
			(handler, keys)
		}
	};

	Ok(quote! {
		#item

		pub fn #factory_name(#factory_params) -> seam_server::UploadDef {
			seam_server::UploadDef {
				name: #name_str.to_string(),
				input_schema: <#input_type as seam_server::SeamType>::jtd_schema(),
				output_schema: <#output_type as seam_server::SeamType>::jtd_schema(),
				error_schema: #error_schema_expr,
				context_keys: #context_keys_expr,
				suppress: None,
				handler: #handler_body,
			}
		}
	})
}

fn extract_input_type(item: &ItemFn) -> syn::Result<Type> {
	let arg = extract_typed_arg(item, 0, "upload must have an input parameter")?;
	match arg {
		syn::FnArg::Typed(pat_type) => Ok((*pat_type.ty).clone()),
		syn::FnArg::Receiver(_) => Err(syn::Error::new_spanned(arg, "upload cannot take self")),
	}
}

fn extract_output_type(item: &ItemFn) -> syn::Result<Type> {
	match &item.sig.output {
		ReturnType::Type(_, ty) => {
			// Expect Result<OutputType, SeamError>
			if let Type::Path(tp) = ty.as_ref()
				&& let Some(seg) = tp.path.segments.last()
				&& let syn::PathArguments::AngleBracketed(args) = &seg.arguments
				&& let Some(syn::GenericArgument::Type(inner)) = args.args.first()
			{
				return Ok(inner.clone());
			}
			Ok((**ty).clone())
		}
		ReturnType::Default => {
			Err(syn::Error::new_spanned(&item.sig, "upload must have a return type"))
		}
	}
}
