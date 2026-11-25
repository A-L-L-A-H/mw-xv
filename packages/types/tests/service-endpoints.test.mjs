import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_BOARD_ORIGIN,
  DEFAULT_CONTROL_PLANE_URL,
  DEFAULT_ISP_SERVICE_URL,
  DEFAULT_LOCALHOST_BOARD_ORIGIN,
  DEFAULT_OLLAMA_URL,
} from '../dist/index.js';

test('service endpoint constants expose canonical local URLs', () => {
  assert.equal(DEFAULT_CONTROL_PLANE_URL, 'http://127.0.0.1:3003');
  assert.equal(DEFAULT_ISP_SERVICE_URL, 'http://127.0.0.1:3002');
  assert.equal(DEFAULT_BOARD_ORIGIN, 'http://127.0.0.1:5173');
  assert.equal(DEFAULT_LOCALHOST_BOARD_ORIGIN, 'http://localhost:5173');
  assert.equal(DEFAULT_OLLAMA_URL, 'http://127.0.0.1:11434');
});
