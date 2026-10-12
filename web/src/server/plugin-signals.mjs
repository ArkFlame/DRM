// Indicators are filename/name tokens, not evidence of infringement or ownership.
const MARKERS = /(?:^|[^a-z0-9])(leak(?:ed)?|crack(?:ed)?|nulled|pirat(?:e|ed)|unlicensed)(?=$|[^a-z0-9])/i;

export function suspiciousReasons(plugin) {
  const fields = [plugin.fileName, plugin.name, plugin.version].filter(v => typeof v === 'string');
  return fields.some(value => MARKERS.test(value)) ? ['Suspicious name or filename marker'] : [];
}
export function suspiciousCount(plugins) { return plugins.filter(p => suspiciousReasons(p).length).length; }
export function summarizePlugins(plugins, productIds) {
  const products = new Set(productIds.map(name => name.toLowerCase()));
  return plugins.map(plugin => ({ ...plugin,
    drm: products.has(plugin.name.toLowerCase()),
    suspicious: suspiciousReasons(plugin).length > 0
  }));
}
