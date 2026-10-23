import { GObject } from '../gi/ext';

// Modified from https://github.com/material-shell/material-shell/blob/main/src/utils/gjs.ts
// Utility function to call `GObject.registerClass` with the given class.
export function registerGObjectClass<
    K,
    T extends { new (..._params: any[]): K },
>(target: T, metaInfo: GObject.MetaInfo<unknown, unknown, unknown> = {}) {
    // Always ensure a unique GTypeName
    if (!metaInfo.GTypeName) {
        // Prefix with something project-specific to avoid cross-extension conflicts
        metaInfo.GTypeName = `TilingShell${target.name}`;
    }

    // @ts-expect-error This is expected
    return GObject.registerClass<K, T>(metaInfo, target) as typeof target;
}
