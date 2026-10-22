export interface PluginApi {
  registerPath(path: string): void;
  unregisterPath(path: string): void;
}

export function getPluginApi(host: unknown): PluginApi | undefined {
  const api = host as { cursor?: { plugins?: Partial<PluginApi> } } | undefined;
  const plugins = api?.cursor?.plugins;
  if (typeof plugins?.registerPath !== 'function' || typeof plugins.unregisterPath !== 'function') return undefined;
  return {
    registerPath: plugins.registerPath.bind(plugins),
    unregisterPath: plugins.unregisterPath.bind(plugins),
  };
}

export function probeEligibility(options: {
  trusted: boolean; remote: boolean; platform: string; arch: string;
  fixture: boolean; pluginApi: boolean;
}): string | undefined {
  if (!options.trusted) return 'workspace-not-trusted';
  if (options.remote) return 'remote-environment-unqualified';
  if (options.platform !== 'darwin' || options.arch !== 'arm64') return 'platform-unqualified';
  if (!options.fixture) return 'invented-fixture-workspace-required';
  if (!options.pluginApi) return 'plugin-registration-api-unavailable';
  return undefined;
}
