import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRIVATE_MESH_CIDRS,
  isLoopbackEndpointUrl,
  isLoopbackHostname,
  isPrivateMeshHost,
  isPrivateMeshIp,
} from '../dist/index.js';

test('PRIVATE_MESH_CIDRS exposes canonical frozen mesh ranges', () => {
  assert.deepEqual(
    [...PRIVATE_MESH_CIDRS],
    ['10.0.0.0/8', '100.64.0.0/10', '172.16.0.0/12', '192.168.0.0/16', 'fd00::/8']
  );
  assert.equal(Object.isFrozen(PRIVATE_MESH_CIDRS), true);
});

test('isPrivateMeshIp validates private mesh IPv4/IPv6 ranges and handles allowLoopback', () => {
  for (const ip of [
    '10.0.0.1',
    '100.64.0.1',
    '100.127.255.254',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.50',
    'fd00::1',
    'fd7a:115c:a1e0::1',
    '[fd12::abcd]',
  ]) {
    assert.equal(isPrivateMeshIp(ip), true, `expected ${ip} to be private mesh IP`);
    assert.equal(isPrivateMeshIp(ip, { allowLoopback: true }), true);
  }

  for (const host of [
    '8.8.8.8',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '192.167.1.1',
    '169.254.169.254',
    'fe80::1',
    'fc00::1',
    '2001:db8::1',
    '::ffff:10.0.0.1',
    'fd00::1%eth0',
    'localhost',
    'http://10.0.0.1',
    '10.0.0.0/8',
    '',
  ]) {
    assert.equal(isPrivateMeshIp(host), false, `expected ${host} to be rejected`);
    assert.equal(isPrivateMeshIp(host, { allowLoopback: true }), false);
  }

  assert.equal(isPrivateMeshIp('127.0.0.1'), false);
  assert.equal(isPrivateMeshIp('::1'), false);
  assert.equal(isPrivateMeshIp('127.0.0.1', { allowLoopback: true }), true);
  assert.equal(isPrivateMeshIp('::1', { allowLoopback: true }), true);
});

test('isPrivateMeshHost accepts http/https URLs and plain mesh IPs only', () => {
  assert.equal(isPrivateMeshHost('http://[fd00::1]:3003/paas/apps'), true);
  assert.equal(isPrivateMeshHost('https://10.144.0.1:8443/a2a'), true);
  assert.equal(isPrivateMeshHost('http://127.0.0.1:3003'), false);
  assert.equal(isPrivateMeshHost('http://127.0.0.1:3003', { allowLoopback: true }), true);
  assert.equal(isPrivateMeshHost('ftp://10.0.0.1/a2a'), false);
  assert.equal(isPrivateMeshHost('http://8.8.8.8:3003'), false);
});

test('isLoopbackHostname and isLoopbackEndpointUrl enforce loopback rules and options', () => {
  assert.equal(isLoopbackHostname('localhost'), true);
  assert.equal(isLoopbackHostname('127.0.0.1'), true);
  assert.equal(isLoopbackHostname('127.0.0.2'), true);
  assert.equal(isLoopbackHostname('127.0.0.2', { allowIpv4LoopbackSubnet: false }), false);
  assert.equal(isLoopbackHostname('[::1]'), true);
  assert.equal(isLoopbackHostname('tauri.localhost'), false);
  assert.equal(
    isLoopbackHostname('tauri.localhost', { extraHostnames: ['tauri.localhost'] }),
    true
  );

  assert.equal(isLoopbackEndpointUrl('http://127.0.0.1:11434/api/tags'), true);
  assert.equal(isLoopbackEndpointUrl('https://localhost:8443'), true);
  assert.equal(isLoopbackEndpointUrl('http://[::1]:8000/v1/models'), true);
  assert.equal(isLoopbackEndpointUrl('https://127.0.0.2:8443/v1/models'), true);

  assert.equal(isLoopbackEndpointUrl('http://0.0.0.0:8000/v1/models'), false);
  assert.equal(isLoopbackEndpointUrl('http://192.168.1.25:11434/api/tags'), false);
  assert.equal(isLoopbackEndpointUrl('http://user:pass@127.0.0.1:11434'), false);
  assert.equal(isLoopbackEndpointUrl('http://127.0.0.1:11434#frag'), false);
  assert.equal(isLoopbackEndpointUrl('file:///etc/passwd'), false);
  assert.equal(isLoopbackEndpointUrl('tauri://localhost'), false);
  assert.equal(
    isLoopbackEndpointUrl('tauri://localhost', {
      allowedProtocols: ['tauri:', 'ws:'],
      extraHostnames: ['ipc.localhost', 'tauri.localhost'],
    }),
    true
  );
  assert.equal(isLoopbackEndpointUrl('http://127.0.0.1:11434?token=leak'), true);
  assert.equal(
    isLoopbackEndpointUrl('http://127.0.0.1:11434?token=leak', { rejectQuery: true }),
    false
  );
});
