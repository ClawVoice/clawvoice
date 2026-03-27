import { Plugin, PluginAPI } from "@openclaw/plugin-sdk";
type OpenClawPluginExports = Plugin & {
    register(api: PluginAPI): void;
    activate(api: PluginAPI): void;
};
declare const plugin: OpenClawPluginExports;
export declare function activate(api: PluginAPI): void;
export declare function register(api: PluginAPI): void;
export declare function _resetForTesting(): void;
export default plugin;
