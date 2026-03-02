/* src/router/seam/src/types.ts */

export type SegmentKind =
  | { type: "static"; value: string }
  | { type: "param"; name: string }
  | { type: "optional-param"; name: string }
  | { type: "catch-all"; name: string }
  | { type: "optional-catch-all"; name: string }
  | { type: "group"; name: string };

export interface RouteNode {
  dirPath: string;
  segment: SegmentKind;
  pageFile: string | null;
  dataFile: string | null;
  layoutFile: string | null;
  layoutDataFile: string | null;
  errorFile: string | null;
  loadingFile: string | null;
  notFoundFile: string | null;
  children: RouteNode[];
}

export interface ValidationError {
  type: "duplicate-path" | "ambiguous-dynamic" | "invalid-segment" | "catch-all-conflict";
  message: string;
  paths: string[];
}
