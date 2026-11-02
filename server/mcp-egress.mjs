import net from 'node:net';
import {lookup} from 'node:dns/promises';
import {normalizeMcpNetwork} from '../shared/mcp-network.mjs';
import {createSocketRelay} from '../shared/socket-relay.mjs';
import {isPrivateAddress,lookupBeforeDeadline} from './sandbox.mjs';

const reservedAddresses = new net.BlockList();
for (const subnet of ['192.0.2.0', '198.51.100.0', '203.0.113.0', '192.88.99.0']) {
  reservedAddresses.addSubnet(subnet, 24, 'ipv4');
}
for (const [subnet, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
  reservedAddresses.addSubnet(subnet, prefix, 'ipv6');
}

export function publicEgressAddress(address) {
  if (net.isIPv4(address)) return !isPrivateAddress(address) && !reservedAddresses.check(address, 'ipv4');
  // Only global unicast IPv6; excludes mapped IPv4, ULA, link-local and multicast.
  return net.isIPv6(address) && /^[23]/.test(address) && !reservedAddresses.check(address, 'ipv6');
}

export function createMcpEgress({network, send, resolver = lookup, connect = net.connect} = {}) {
  const hosts = new Set(normalizeMcpNetwork(network).allowedHosts);
  const relay = createSocketRelay({send});
  const controllers = new Set();
  let closed = false;

  return {
    handle: relay.handle,
    async open(args, signal) {
      if (closed || !args || !hosts.has(args.host) || args.port !== 443
          || typeof args.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(args.id)) {
        throw Error('MCP egress destination is not allowed');
      }
      if (controllers.size >= 8) throw Error('MCP egress connection limit reached');
      const controller = new AbortController();
      controllers.add(controller);
      const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
      let socket;
      const timer = setTimeout(() => controller.abort(), 10000);
      timer.unref();
      try {
        socket = connect({
          host: args.host, port: 443, autoSelectFamily: false, signal: combined,
          // Pin the checked DNS answer: never resolve again after validation,
          // and reject mixed public/private answers before opening a connection.
          lookup: (_host, _options, done) => {
            lookupBeforeDeadline(args.host, Date.now() + 8000, combined, {resolver}).then(addresses => {
              if (!addresses.length || addresses.some(a => !publicEgressAddress(a.address))) {
                throw Error('MCP egress cannot access private or reserved addresses');
              }
              const picked = addresses.find(a => a.family === 4) || addresses[0];
              done(null, picked.address, picked.family);
            }).catch(error => done(error));
          },
        });
        socket.on('error', () => {});
        const stream = relay.add(args.id, socket, {paused: true});
        socket.once('close', () => { controller.abort(); controllers.delete(controller); });
        await new Promise((resolve, reject) => {
          socket.once('connect', resolve);
          socket.once('error', reject);
          socket.once('close', () => reject(Error('MCP egress closed')));
        });
        stream.start();
        return {ok: true};
      } catch (error) {
        socket?.destroy();
        controller.abort();
        controllers.delete(controller);
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
    close() {
      closed = true;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      relay.close();
    },
  };
}
