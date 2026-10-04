import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	return { name: 'world', at: new Date().toISOString() };
};
