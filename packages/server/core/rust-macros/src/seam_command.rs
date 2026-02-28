/* packages/server/core/rust-macros/src/seam_command.rs */

use proc_macro2::TokenStream;
use quote::quote;
use syn::ItemFn;

use crate::seam_procedure::{expand_with_type, ProcedureAttr};

pub fn expand(attr: TokenStream, item: ItemFn) -> syn::Result<TokenStream> {
  let parsed_attr: ProcedureAttr = syn::parse2(attr)?;
  expand_with_type(parsed_attr, item, quote! { seam_server::ProcedureType::Command })
}
