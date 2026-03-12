/* src/eslint/__tests__/no-derived-data-in-skeleton.test.ts */

import { RuleTester } from 'eslint'
import { afterAll, describe, it } from 'vitest'
import rule from '../src/rules/no-derived-data-in-skeleton.js'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({
	languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
})

const SKELETON = 'home-skeleton.tsx'

tester.run('no-derived-data-in-skeleton', rule, {
	valid: [
		{
			code: `
        const { title, show } = useSeamData();
        const body = show ? title : null;
      `,
			filename: SKELETON,
		},
		{
			code: `
        const { items } = useSeamData();
        const rows = items.map((item) => item.name);
      `,
			filename: SKELETON,
		},
		{
			code: `
        const price = Number(input);
      `,
			filename: 'home.tsx',
		},
	],
	invalid: [
		{
			code: `
        const { price } = useSeamData();
        const discount = price * 0.8;
      `,
			filename: SKELETON,
			errors: [{ messageId: 'arithmetic' }],
		},
		{
			code: `
        const { price } = useSeamData();
        const expensive = price > 1000;
      `,
			filename: SKELETON,
			errors: [{ messageId: 'numericComparison' }],
		},
		{
			code: `
        const { formattedPrice } = useSeamData();
        const label = formattedPrice.toUpperCase();
      `,
			filename: SKELETON,
			errors: [{ messageId: 'formatMethod', data: { method: 'toUpperCase' } }],
		},
		{
			code: `
        const { watches } = useSeamData();
        const visible = watches.filter((watch) => watch.visible);
      `,
			filename: SKELETON,
			errors: [{ messageId: 'arrayDerivation', data: { method: 'filter' } }],
		},
		{
			code: `
        const { createdAt } = useSeamData();
        const date = new Date(createdAt);
      `,
			filename: SKELETON,
			errors: [{ messageId: 'dateConstruction' }],
		},
		{
			code: `
        const { watches } = useSeamData();
        const rows = watches.map((watch) => watch.price > 0 ? 'paid' : 'free');
      `,
			filename: SKELETON,
			errors: [{ messageId: 'numericComparison' }],
		},
	],
})
