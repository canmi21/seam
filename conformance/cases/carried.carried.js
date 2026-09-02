var __carried = (() => {
	var __defProp = Object.defineProperty;
	var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
	var __getOwnPropNames = Object.getOwnPropertyNames;
	var __hasOwnProp = Object.prototype.hasOwnProperty;
	var __export = (target, all) => {
		for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
	};
	var __copyProps = (to, from, except, desc) => {
		if ((from && typeof from === 'object') || typeof from === 'function') {
			for (let key of __getOwnPropNames(from))
				if (!__hasOwnProp.call(to, key) && key !== except)
					__defProp(to, key, {
						get: () => from[key],
						enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
					});
		}
		return to;
	};
	var __toCommonJS = (mod) => __copyProps(__defProp({}, '__esModule', { value: true }), mod);

	// conformance/cases/carried.ts
	var carried_exports = {};
	__export(carried_exports, {
		cn: () => cn,
	});

	// conformance/cases/parts/classes.ts
	function flatten(value) {
		if (Array.isArray(value)) return value.map(flatten).filter(Boolean).join(' ');
		return typeof value === 'string' && value !== '' ? value : '';
	}
	function cn(...parts) {
		return flatten(parts);
	}
	return __toCommonJS(carried_exports);
})();
