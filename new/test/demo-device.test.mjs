import assert from 'node:assert/strict';
import test from 'node:test';
import { getDemoDeviceKind } from '../src/lib/demoDevice.ts';

test('phones receive keyboard and small-screen guidance regardless of orientation', () => {
  for (const info of [
    { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5 },
    { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130 Mobile Safari/537.36', maxTouchPoints: 5 },
    { userAgent: 'reduced UA', maxTouchPoints: 5, mobileHint: true },
  ]) assert.equal(getDemoDeviceKind(info), 'phone');
});
test('iPadOS desktop identity and Android tablets receive keyboard guidance only', () => {
  assert.equal(getDemoDeviceKind({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 5 }), 'tablet');
  assert.equal(getDemoDeviceKind({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Tablet) Chrome/130 Safari/537.36', maxTouchPoints: 5, mobileHint: false }), 'tablet');
  assert.equal(getDemoDeviceKind({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', maxTouchPoints: 5, mobileHint: true }), 'tablet');
});
test('touch-only visitors are covered without classifying a narrow desktop window as a phone', () => {
  assert.equal(getDemoDeviceKind({ userAgent: 'desktop UA', maxTouchPoints: 5, coarsePointer: true, screenWidth: 1024, screenHeight: 1366 }), 'tablet');
  assert.equal(getDemoDeviceKind({ userAgent: 'desktop UA', maxTouchPoints: 0, coarsePointer: false, screenWidth: 390, screenHeight: 844 }), 'desktop');
  assert.equal(getDemoDeviceKind({ userAgent: 'desktop UA', maxTouchPoints: 5, coarsePointer: true, screenWidth: 844, screenHeight: 390 }), 'phone');
});
