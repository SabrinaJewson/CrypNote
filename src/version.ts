import packageJsonRaw from "../package.json";
export const currentVersion = (packageJsonRaw as { version: string }).version;
export const latestVersion = globalThis.latestVersion as undefined | string;
