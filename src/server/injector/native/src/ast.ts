/* src/server/injector/native/src/ast.ts */

export type AstNode =
  | TextNode
  | SlotNode
  | AttrNode
  | StylePropNode
  | IfNode
  | EachNode
  | MatchNode;

export interface TextNode {
  type: "text";
  value: string;
}

export interface SlotNode {
  type: "slot";
  path: string;
  mode: "text" | "html";
}

export interface AttrNode {
  type: "attr";
  path: string;
  attrName: string;
}

export interface StylePropNode {
  type: "styleProp";
  path: string;
  cssProperty: string;
}

export interface IfNode {
  type: "if";
  path: string;
  thenNodes: AstNode[];
  elseNodes: AstNode[];
}

export interface EachNode {
  type: "each";
  path: string;
  bodyNodes: AstNode[];
}

export interface MatchNode {
  type: "match";
  path: string;
  branches: Map<string, AstNode[]>;
}
