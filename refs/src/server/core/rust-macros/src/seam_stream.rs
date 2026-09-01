/* src/server/core/rust-macros/src/seam_stream.rs */

use proc_macro2::TokenStream;
use quote::quote;
use syn::parse::{Parse, ParseStream};
use syn::{ItemFn, LitStr, ReturnType, Token, Type};

use crate::seam_procedure::{ensure_arg_count, extract_input_type};

struct StreamAttr {
	name: Option<String>,
	context: Option<syn::Path>,
	state: Option<syn::Path>,
}

impl Parse for StreamAttr {
	fn parse(input: ParseStream) -> syn::Result<Self> {
		let mut name = None;
		let mut context = None;
		let mut state = None;

		while !input.is_empty() {
			let ident: syn::Ident = input.parse()?;
			if ident == "name" {
				input.parse::<Token![=]>()?;
				let lit: LitStr = input.parse()?;
				name = Some(lit.value());
			} else if ident == "context" {
				input.parse::<Token![=]>()?;
				context = Some(input.parse::<syn::Path>()?);
			} else if ident == "state" {
				input.parse::<Token![=]>()?;
				state = Some(input.parse::<syn::Path>()?);
			} else {
				return Err(syn::Error::new_spanned(ident, "expected `name`, `context`, or `state`"));
			}
			let _ = input.parse::<Token![,]>();
		}

		Ok(StreamAttr { name, context, state })
	}
}

#[allow(clippy::needless_pass_by_value)]
pub fn expand(attr: TokenStream, item: ItemFn) -> syn::Result<TokenStream> {
	let parsed_attr: StreamAttr = syn::parse2(attr)?;

	let fn_name = &item.sig.ident;
	let factory_name = syn::Ident::new(&format!("{fn_name}_stream"), fn_name.span());

	let input_type = extract_input_type(&item)?;
	let output_type = extract_output_type(&item)?;
	let name_str = parsed_attr.name.unwrap_or_else(|| fn_name.to_string());
	let expected_args =
		1 + usize::from(parsed_attr.context.is_some()) + usize::from(parsed_attr.state.is_some());
	ensure_arg_count(&item, expected_args, "stream")?;
	let factory_params = match parsed_attr.state.clone() {
		Some(state_path) => quote! { state: std::sync::Arc<#state_path> },
		None => quote! {},
	};

	let (handler_body, context_keys_expr) = match (parsed_attr.context, parsed_attr.state) {
		(Some(ctx_path), Some(_state_path)) => {
			let handler = quote! {
				std::sync::Arc::new(move |params: seam_server::StreamParams| {
					let state = std::sync::Arc::clone(&state);
					Box::pin(async move {
						let input: #input_type = serde_json::from_value(params.input)
							.map_err(|e| seam_server::SeamError::validation(e.to_string()))?;
						let ctx: #ctx_path = serde_json::from_value(params.ctx)
							.map_err(|e| seam_server::SeamError::context_error(e.to_string()))?;
						let stream = #fn_name(input, ctx, &state).await?;
						Ok(seam_server::map_stream_output(stream))
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
		(Some(ctx_path), None) => {
			let handler = quote! {
				std::sync::Arc::new(|params: seam_server::StreamParams| {
					Box::pin(async move {
						let input: #input_type = serde_json::from_value(params.input)
							.map_err(|e| seam_server::SeamError::validation(e.to_string()))?;
						let ctx: #ctx_path = serde_json::from_value(params.ctx)
							.map_err(|e| seam_server::SeamError::context_error(e.to_string()))?;
						let stream = #fn_name(input, ctx).await?;
						Ok(seam_server::map_stream_output(stream))
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
				std::sync::Arc::new(move |params: seam_server::StreamParams| {
					let state = std::sync::Arc::clone(&state);
					Box::pin(async move {
						let input: #input_type = serde_json::from_value(params.input)
							.map_err(|e| seam_server::SeamError::validation(e.to_string()))?;
						let stream = #fn_name(input, &state).await?;
						Ok(seam_server::map_stream_output(stream))
					})
				})
			};
			let keys = quote! { vec![] };
			(handler, keys)
		}
		(None, None) => {
			let handler = quote! {
				std::sync::Arc::new(|params: seam_server::StreamParams| {
					Box::pin(async move {
						let input: #input_type = serde_json::from_value(params.input)
							.map_err(|e| seam_server::SeamError::validation(e.to_string()))?;
						let stream = #fn_name(input).await?;
						Ok(seam_server::map_stream_output(stream))
					})
				})
			};
			let keys = quote! { vec![] };
			(handler, keys)
		}
	};

	Ok(quote! {
		#item

		pub fn #factory_name(#factory_params) -> seam_server::StreamDef {
			seam_server::StreamDef {
				name: #name_str.to_string(),
				input_schema: <#input_type as seam_server::SeamType>::jtd_schema(),
				chunk_output_schema: <#output_type as seam_server::SeamType>::jtd_schema(),
				error_schema: None,
				context_keys: #context_keys_expr,
				suppress: None,
				handler: #handler_body,
			}
		}
	})
}

fn extract_output_type(item: &ItemFn) -> syn::Result<Type> {
	match &item.sig.output {
		ReturnType::Type(_, ty) => {
			// Expect Result<BoxStream<Result<ChunkType, SeamError>>, SeamError>
			// Dig through: Result -> BoxStream -> Result -> ChunkType
			if let Some(inner) = extract_first_generic_arg(ty) {
				if let Some(stream_inner) = extract_first_generic_arg(&inner) {
					if let Some(output) = extract_first_generic_arg(&stream_inner) {
						return Ok(output);
					}
					return Ok(stream_inner);
				}
				return Ok(inner);
			}
			Ok((**ty).clone())
		}
		ReturnType::Default => {
			Err(syn::Error::new_spanned(&item.sig, "stream must have a return type"))
		}
	}
}

fn extract_first_generic_arg(ty: &Type) -> Option<Type> {
	if let Type::Path(tp) = ty
		&& let Some(seg) = tp.path.segments.last()
		&& let syn::PathArguments::AngleBracketed(args) = &seg.arguments
		&& let Some(syn::GenericArgument::Type(inner)) = args.args.first()
	{
		return Some(inner.clone());
	}
	None
}
