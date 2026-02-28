/* packages/server/core/rust-macros/src/lib.rs */

mod seam_command;
mod seam_procedure;
mod seam_subscription;
mod seam_type;

use proc_macro::TokenStream;

#[proc_macro_derive(SeamType, attributes(seam))]
pub fn derive_seam_type(input: TokenStream) -> TokenStream {
  let input = syn::parse_macro_input!(input as syn::DeriveInput);
  match seam_type::expand(input) {
    Ok(tokens) => tokens.into(),
    Err(e) => e.to_compile_error().into(),
  }
}

#[proc_macro_attribute]
pub fn seam_procedure(attr: TokenStream, item: TokenStream) -> TokenStream {
  let attr = proc_macro2::TokenStream::from(attr);
  let item = syn::parse_macro_input!(item as syn::ItemFn);
  match seam_procedure::expand(attr, item) {
    Ok(tokens) => tokens.into(),
    Err(e) => e.to_compile_error().into(),
  }
}

#[proc_macro_attribute]
pub fn seam_command(attr: TokenStream, item: TokenStream) -> TokenStream {
  let attr = proc_macro2::TokenStream::from(attr);
  let item = syn::parse_macro_input!(item as syn::ItemFn);
  match seam_command::expand(attr, item) {
    Ok(tokens) => tokens.into(),
    Err(e) => e.to_compile_error().into(),
  }
}

#[proc_macro_attribute]
pub fn seam_subscription(attr: TokenStream, item: TokenStream) -> TokenStream {
  let attr = proc_macro2::TokenStream::from(attr);
  let item = syn::parse_macro_input!(item as syn::ItemFn);
  match seam_subscription::expand(attr, item) {
    Ok(tokens) => tokens.into(),
    Err(e) => e.to_compile_error().into(),
  }
}
