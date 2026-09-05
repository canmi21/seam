
// this file is generated — do not edit it


/// <reference types="@sveltejs/kit" />

/**
 * This module provides access to environment variables that are injected _statically_ into your bundle at build time and are limited to _private_ access.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Static environment variables are [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env` at build time and then statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * **_Private_ access:**
 * 
 * - This module cannot be imported into client-side code
 * - This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured)
 * 
 * For example, given the following build time environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { ENVIRONMENT, PUBLIC_BASE_URL } from '$env/static/private';
 * 
 * console.log(ENVIRONMENT); // => "production"
 * console.log(PUBLIC_BASE_URL); // => throws error during build
 * ```
 * 
 * The above values will be the same _even if_ different values for `ENVIRONMENT` or `PUBLIC_BASE_URL` are set at runtime, as they are statically replaced in your code with their build time values.
 */
declare module '$env/static/private' {
	export const CLAUDE_CODE_MESSAGING_TOKEN: string;
	export const LDFLAGS: string;
	export const MANPATH: string;
	export const NoDefaultCurrentDirectoryInExePath: string;
	export const __MISE_DIFF: string;
	export const CLAUDE_EFFORT: string;
	export const CLAUDE_CODE_ENTRYPOINT: string;
	export const OPENAI_BASE_URL: string;
	export const SHELL: string;
	export const TERM: string;
	export const CLAUDE_PID: string;
	export const CLAUDE_CODE_CHILD_SESSION: string;
	export const TMPDIR: string;
	export const CPPFLAGS: string;
	export const JJ_CONFIG: string;
	export const WINDOWID: string;
	export const MallocNanoZone: string;
	export const SOPS_AGE_KEY_FILE: string;
	export const PNPM_HOME: string;
	export const GIT_EDITOR: string;
	export const AI_AGENT: string;
	export const USER: string;
	export const INVOCATION_ID: string;
	export const CLAUDE_AGENTS_SELECT: string;
	export const COMMAND_MODE: string;
	export const OPENAI_API_KEY: string;
	export const CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: string;
	export const SSH_AUTH_SOCK: string;
	export const LAUNCHCTL_ENV_REEXEC: string;
	export const __CF_USER_TEXT_ENCODING: string;
	export const PATH: string;
	export const CARGO_HOME: string;
	export const npm_command: string;
	export const PWD: string;
	export const KITTY_PID: string;
	export const LANG: string;
	export const NODE_PATH: string;
	export const XPC_FLAGS: string;
	export const FORCE_COLOR: string;
	export const RUSTUP_TOOLCHAIN: string;
	export const pnpm_config_verify_deps_before_run: string;
	export const XPC_SERVICE_NAME: string;
	export const SHLVL: string;
	export const HOME: string;
	export const CLAUDE_JOB_DIR: string;
	export const TERMINFO: string;
	export const __MISE_ORIG_PATH: string;
	export const CLAUDE_CODE_EXECPATH: string;
	export const MISE_SHELL: string;
	export const RUSTUP_HOME: string;
	export const LOGNAME: string;
	export const PNPM_PACKAGE_NAME: string;
	export const COREPACK_ENABLE_AUTO_PIN: string;
	export const PKG_CONFIG_PATH: string;
	export const npm_config_user_agent: string;
	export const KITTY_INSTALLATION_DIR: string;
	export const CLAUDE_CODE_SESSION_ID: string;
	export const WRANGLER_SEND_METRICS: string;
	export const __MISE_SESSION: string;
	export const OSLogRateLimit: string;
	export const CLAUDE_CODE_DISABLE_1M_CONTEXT: string;
	export const CLAUDECODE: string;
	export const CLAUDE_CODE_MESSAGING_SOCKET: string;
	export const HOMEBREW_NO_ENV_HINTS: string;
	export const KITTY_PUBLIC_KEY: string;
	export const COLORTERM: string;
	export const TEST: string;
	export const VITEST: string;
	export const NODE_ENV: string;
	export const PROD: string;
	export const DEV: string;
	export const BASE_URL: string;
	export const MODE: string;
	export const VITEST_MODE: string;
	export const FORCE_TTY: string;
	export const VITEST_POOL_ID: string;
	export const VITEST_WORKER_ID: string;
	export const SSR: string;
}

/**
 * This module provides access to environment variables that are injected _statically_ into your bundle at build time and are _publicly_ accessible.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Static environment variables are [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env` at build time and then statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * **_Public_ access:**
 * 
 * - This module _can_ be imported into client-side code
 * - **Only** variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`) are included
 * 
 * For example, given the following build time environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { ENVIRONMENT, PUBLIC_BASE_URL } from '$env/static/public';
 * 
 * console.log(ENVIRONMENT); // => throws error during build
 * console.log(PUBLIC_BASE_URL); // => "http://site.com"
 * ```
 * 
 * The above values will be the same _even if_ different values for `ENVIRONMENT` or `PUBLIC_BASE_URL` are set at runtime, as they are statically replaced in your code with their build time values.
 */
declare module '$env/static/public' {
	
}

/**
 * This module provides access to environment variables set _dynamically_ at runtime and that are limited to _private_ access.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Dynamic environment variables are defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`.
 * 
 * **_Private_ access:**
 * 
 * - This module cannot be imported into client-side code
 * - This module includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured)
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 * 
 * > [!NOTE] To get correct types, environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * >
 * > ```env
 * > MY_FEATURE_FLAG=
 * > ```
 * >
 * > You can override `.env` values from the command line like so:
 * >
 * > ```sh
 * > MY_FEATURE_FLAG="enabled" npm run dev
 * > ```
 * 
 * For example, given the following runtime environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { env } from '$env/dynamic/private';
 * 
 * console.log(env.ENVIRONMENT); // => "production"
 * console.log(env.PUBLIC_BASE_URL); // => undefined
 * ```
 */
declare module '$env/dynamic/private' {
	export const env: {
		CLAUDE_CODE_MESSAGING_TOKEN: string;
		LDFLAGS: string;
		MANPATH: string;
		NoDefaultCurrentDirectoryInExePath: string;
		__MISE_DIFF: string;
		CLAUDE_EFFORT: string;
		CLAUDE_CODE_ENTRYPOINT: string;
		OPENAI_BASE_URL: string;
		SHELL: string;
		TERM: string;
		CLAUDE_PID: string;
		CLAUDE_CODE_CHILD_SESSION: string;
		TMPDIR: string;
		CPPFLAGS: string;
		JJ_CONFIG: string;
		WINDOWID: string;
		MallocNanoZone: string;
		SOPS_AGE_KEY_FILE: string;
		PNPM_HOME: string;
		GIT_EDITOR: string;
		AI_AGENT: string;
		USER: string;
		INVOCATION_ID: string;
		CLAUDE_AGENTS_SELECT: string;
		COMMAND_MODE: string;
		OPENAI_API_KEY: string;
		CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: string;
		SSH_AUTH_SOCK: string;
		LAUNCHCTL_ENV_REEXEC: string;
		__CF_USER_TEXT_ENCODING: string;
		PATH: string;
		CARGO_HOME: string;
		npm_command: string;
		PWD: string;
		KITTY_PID: string;
		LANG: string;
		NODE_PATH: string;
		XPC_FLAGS: string;
		FORCE_COLOR: string;
		RUSTUP_TOOLCHAIN: string;
		pnpm_config_verify_deps_before_run: string;
		XPC_SERVICE_NAME: string;
		SHLVL: string;
		HOME: string;
		CLAUDE_JOB_DIR: string;
		TERMINFO: string;
		__MISE_ORIG_PATH: string;
		CLAUDE_CODE_EXECPATH: string;
		MISE_SHELL: string;
		RUSTUP_HOME: string;
		LOGNAME: string;
		PNPM_PACKAGE_NAME: string;
		COREPACK_ENABLE_AUTO_PIN: string;
		PKG_CONFIG_PATH: string;
		npm_config_user_agent: string;
		KITTY_INSTALLATION_DIR: string;
		CLAUDE_CODE_SESSION_ID: string;
		WRANGLER_SEND_METRICS: string;
		__MISE_SESSION: string;
		OSLogRateLimit: string;
		CLAUDE_CODE_DISABLE_1M_CONTEXT: string;
		CLAUDECODE: string;
		CLAUDE_CODE_MESSAGING_SOCKET: string;
		HOMEBREW_NO_ENV_HINTS: string;
		KITTY_PUBLIC_KEY: string;
		COLORTERM: string;
		TEST: string;
		VITEST: string;
		NODE_ENV: string;
		PROD: string;
		DEV: string;
		BASE_URL: string;
		MODE: string;
		VITEST_MODE: string;
		FORCE_TTY: string;
		VITEST_POOL_ID: string;
		VITEST_WORKER_ID: string;
		SSR: string;
		[key: `PUBLIC_${string}`]: undefined;
		[key: `${string}`]: string | undefined;
	}
}

/**
 * This module provides access to environment variables set _dynamically_ at runtime and that are _publicly_ accessible.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Dynamic environment variables are defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`.
 * 
 * **_Public_ access:**
 * 
 * - This module _can_ be imported into client-side code
 * - **Only** variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`) are included
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 * 
 * > [!NOTE] To get correct types, environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * >
 * > ```env
 * > MY_FEATURE_FLAG=
 * > ```
 * >
 * > You can override `.env` values from the command line like so:
 * >
 * > ```sh
 * > MY_FEATURE_FLAG="enabled" npm run dev
 * > ```
 * 
 * For example, given the following runtime environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://example.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { env } from '$env/dynamic/public';
 * console.log(env.ENVIRONMENT); // => undefined, not public
 * console.log(env.PUBLIC_BASE_URL); // => "http://example.com"
 * ```
 * 
 * ```
 * 
 * ```
 */
declare module '$env/dynamic/public' {
	export const env: {
		[key: `PUBLIC_${string}`]: string | undefined;
	}
}
