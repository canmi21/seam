// The vendored source is JavaScript with JSDoc, and this is the check that the repository's own
// program reads it as typed: a wrong argument here is a type error, not a runtime surprise.
import { describe, expect, it } from 'vitest';
import { bound, found, parsed, written } from './index.ts';

describe('a route id is read the way Kit reads it', () => {
	it('binds a parameter and a rest', () => {
		const route = parsed('/blog/[slug]/[...rest]');
		expect(route.params.map((one) => one.name)).toEqual(['slug', 'rest']);
		const match = '/blog/hello/a/b'.match(route.pattern);
		expect(match).not.toBeNull();
		expect(bound(match as RegExpMatchArray, route.params)).toEqual({ slug: 'hello', rest: 'a/b' });
	});

	it('writes parameters back into an id', () => {
		expect(written('/blog/[slug]', { slug: 'x' })).toBe('/blog/x');
		expect(written('/[[lang]]/about', { lang: undefined })).toBe('/about');
	});

	it("takes routes in the order they are given, which is the manifest's sorted one", () => {
		// `find_route` tries routes in order; the order is `sort_routes`'s, made once when the
		// manifest is, so the most specific comes first here as it would there.
		const routes = ['/blog/new', '/blog/[slug]', '/[...rest]'].map((id) => {
			const { pattern, params } = parsed(id);
			return { id, pattern, params };
		});
		expect(found('/blog/new', routes, {})?.route.id).toBe('/blog/new');
		expect(found('/blog/x', routes, {})?.route.id).toBe('/blog/[slug]');
		expect(found('/anything/else', routes, {})?.route.id).toBe('/[...rest]');
	});
});
