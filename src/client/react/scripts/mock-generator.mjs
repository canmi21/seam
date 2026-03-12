/* src/client/react/scripts/mock-generator.mjs */

export {
	generateMockFromSchema,
	flattenLoaderMock,
	buildStructuralSample,
	deepMerge,
} from './mock-generator-schema.mjs'
export {
	collectSchemaPaths,
	levenshtein,
	didYouMean,
	collectHtmlPaths,
} from './mock-generator-paths.mjs'
export { createAccessTracker, checkFieldAccess } from './mock-generator-tracking.mjs'
