// Shared by the trusted configuration API, browser form and egress gateway.
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const LOCAL_SUFFIX = /(^|\.)(localhost|local|internal)$/;

export function normalizeMcpNetwork(value) {
  if (value === undefined) return {allowedHosts: []};
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => key !== 'allowedHosts')
      || !Array.isArray(value.allowedHosts) || value.allowedHosts.length > 32) {
    throw Error('MCP network requires at most 32 exact allowedHosts');
  }
  const hosts = value.allowedHosts.map(host => {
    if (typeof host !== 'string') throw Error('Invalid MCP network hostname');
    host = host.trim().toLowerCase();
    const labels = host.split('.');
    if (host.length > 253 || labels.length < 2 || !labels.every(label => DNS_LABEL.test(label))
        || !/[a-z]/.test(labels.at(-1)) || LOCAL_SUFFIX.test(host)) {
      throw Error('Use exact public DNS names, without URLs, ports, IPs or wildcards');
    }
    return host;
  });
  return {allowedHosts: [...new Set(hosts)]};
}
