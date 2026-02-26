/* packages/client/react/scripts/skeleton/process.mjs */

import { buildI18nValue, computeCacheKey, pathToSlug, readCache, writeCache } from "./cache.mjs";
import { renderLayout } from "./layout.mjs";
import { renderRoute } from "./schema.mjs";

function processLayoutsWithCache(layoutMap, ctx) {
  return [...layoutMap.entries()].map(([id, entry]) => {
    // i18n: render once per locale, return localeHtml map
    if (ctx.i18n) {
      const localeHtml = {};
      let collectedKeys = null;
      for (const locale of ctx.i18n.locales) {
        const i18nValue = buildI18nValue(locale, ctx.i18n.messages, ctx.i18n.default);
        const messagesJson = JSON.stringify(ctx.i18n.messages?.[locale] || {});
        const compHash = ctx.componentHashes.get(entry.component?.name);
        if (compHash) {
          const config = { id, loaders: entry.loaders, mock: entry.mock };
          const key = computeCacheKey(
            compHash,
            ctx.manifestContent,
            config,
            ctx.scriptHash,
            locale,
            messagesJson,
          );
          const slug = `layout_${id}_${locale}`;
          const cached = readCache(ctx.cacheDir, slug);
          if (cached && cached.key === key) {
            ctx.stats.hits++;
            localeHtml[locale] = cached.data.html;
            if (!collectedKeys) collectedKeys = cached.data.i18nKeys;
            continue;
          }
          const html = renderLayout(
            entry.component,
            id,
            entry,
            ctx.manifest,
            i18nValue,
            ctx.warnCtx,
          );
          const i18nKeys = [...i18nValue._usedKeys].sort();
          writeCache(ctx.cacheDir, slug, key, { html, i18nKeys });
          ctx.stats.misses++;
          localeHtml[locale] = html;
          if (!collectedKeys) collectedKeys = i18nKeys;
        } else {
          ctx.stats.misses++;
          const html = renderLayout(
            entry.component,
            id,
            entry,
            ctx.manifest,
            i18nValue,
            ctx.warnCtx,
          );
          const i18nKeys = [...i18nValue._usedKeys].sort();
          localeHtml[locale] = html;
          if (!collectedKeys) collectedKeys = i18nKeys;
        }
      }
      return {
        id,
        localeHtml,
        loaders: entry.loaders,
        parent: entry.parentId,
        i18nKeys: collectedKeys || [],
      };
    }

    // No i18n: original behavior
    const compHash = ctx.componentHashes.get(entry.component?.name);
    if (compHash) {
      const config = { id, loaders: entry.loaders, mock: entry.mock };
      const key = computeCacheKey(compHash, ctx.manifestContent, config, ctx.scriptHash);
      const slug = `layout_${id}`;
      const cached = readCache(ctx.cacheDir, slug);
      if (cached && cached.key === key) {
        ctx.stats.hits++;
        return cached.data;
      }
      const data = {
        id,
        html: renderLayout(entry.component, id, entry, ctx.manifest, undefined, ctx.warnCtx),
        loaders: entry.loaders,
        parent: entry.parentId,
      };
      writeCache(ctx.cacheDir, slug, key, data);
      ctx.stats.misses++;
      return data;
    }
    ctx.stats.misses++;
    return {
      id,
      html: renderLayout(entry.component, id, entry, ctx.manifest, undefined, ctx.warnCtx),
      loaders: entry.loaders,
      parent: entry.parentId,
    };
  });
}

function processRoutesWithCache(flat, ctx) {
  return flat.map((r) => {
    // i18n: render once per locale, return localeVariants map
    if (ctx.i18n) {
      const localeVariants = {};
      let collectedKeys = null;
      for (const locale of ctx.i18n.locales) {
        const i18nValue = buildI18nValue(locale, ctx.i18n.messages, ctx.i18n.default);
        const messagesJson = JSON.stringify(ctx.i18n.messages?.[locale] || {});
        const compHash = ctx.componentHashes.get(r.component?.name);
        if (compHash) {
          const config = { path: r.path, loaders: r.loaders, mock: r.mock, nullable: r.nullable };
          const key = computeCacheKey(
            compHash,
            ctx.manifestContent,
            config,
            ctx.scriptHash,
            locale,
            messagesJson,
          );
          const slug = `route_${pathToSlug(r.path)}_${locale}`;
          const cached = readCache(ctx.cacheDir, slug);
          if (cached && cached.key === key) {
            ctx.stats.hits++;
            localeVariants[locale] = cached.data;
            if (!collectedKeys) collectedKeys = cached.data.i18nKeys;
            continue;
          }
          const data = renderRoute(r, ctx.manifest, i18nValue, ctx.warnCtx);
          data.i18nKeys = [...i18nValue._usedKeys].sort();
          writeCache(ctx.cacheDir, slug, key, data);
          ctx.stats.misses++;
          localeVariants[locale] = data;
          if (!collectedKeys) collectedKeys = data.i18nKeys;
        } else {
          ctx.stats.misses++;
          const data = renderRoute(r, ctx.manifest, i18nValue, ctx.warnCtx);
          data.i18nKeys = [...i18nValue._usedKeys].sort();
          localeVariants[locale] = data;
          if (!collectedKeys) collectedKeys = data.i18nKeys;
        }
      }
      // Combine per-locale data into the expected output format
      const first = localeVariants[ctx.i18n.locales[0]];
      return {
        path: r.path,
        loaders: first.loaders,
        layout: first.layout,
        mock: first.mock,
        pageSchema: first.pageSchema,
        i18nKeys: collectedKeys || [],
        localeVariants: Object.fromEntries(
          Object.entries(localeVariants).map(([loc, data]) => [
            loc,
            { axes: data.axes, variants: data.variants, mockHtml: data.mockHtml },
          ]),
        ),
      };
    }

    // No i18n: original behavior
    const compHash = ctx.componentHashes.get(r.component?.name);
    if (compHash) {
      const config = { path: r.path, loaders: r.loaders, mock: r.mock, nullable: r.nullable };
      const key = computeCacheKey(compHash, ctx.manifestContent, config, ctx.scriptHash);
      const slug = `route_${pathToSlug(r.path)}`;
      const cached = readCache(ctx.cacheDir, slug);
      if (cached && cached.key === key) {
        ctx.stats.hits++;
        return cached.data;
      }
      const data = renderRoute(r, ctx.manifest, undefined, ctx.warnCtx);
      writeCache(ctx.cacheDir, slug, key, data);
      ctx.stats.misses++;
      return data;
    }
    ctx.stats.misses++;
    return renderRoute(r, ctx.manifest, undefined, ctx.warnCtx);
  });
}

export { processLayoutsWithCache, processRoutesWithCache };
