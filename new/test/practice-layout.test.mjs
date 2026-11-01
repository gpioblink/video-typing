import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePracticeLayout, clampPanelGeometry } from '../src/lib/practiceLayout.ts';

const inside = (rect, width, height) => rect.x >= 0 && rect.y >= 0
  && rect.width > 0 && rect.height > 0 && rect.x + rect.width <= width + 0.001 && rect.y + rect.height <= height + 0.001;
const overlaps = (a, b) => a.x < b.x + b.width - 0.001 && a.x + a.width > b.x + 0.001
  && a.y < b.y + b.height - 0.001 && a.y + a.height > b.y + 0.001;
function rectangles(layout) {
  return Object.entries(layout.panels).map(([kind, panel]) => ({
    kind, x: panel.position.x, y: panel.position.y,
    width: panel.size.width, height: panel.defaultMinimized ? 40 : panel.size.height,
  }));
}

for (const [width, height] of [[1280, 720], [1366, 768], [1920, 1080], [1024, 600], [800, 600], [390, 844], [390, 720], [390, 600]]) {
  for (const mode of ['mini', 'fullscreen']) {
    test(`${mode} ${width}×${height} places every panel within the viewport without initial overlap`, () => {
      const layout = calculatePracticeLayout(width, height, mode);
      const panels = rectangles(layout);
      assert.deepEqual(panels.map(panel => panel.kind).sort(), ['config', 'controls', 'hint', 'subtitle', 'typing']);
      for (const rect of panels) {
        assert.ok(inside(rect, width, height), `${rect.kind} is outside the viewport: ${JSON.stringify(rect)}`);
        assert.ok(rect.y >= 72, `${rect.kind} covers the page header`);
        assert.ok(rect.y + rect.height <= height - 16, `${rect.kind} covers the footer clearance`);
      }
      for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
        assert.equal(overlaps(panels[i], panels[j]), false, `${panels[i].kind} overlaps ${panels[j].kind}`);
      }
      assert.ok(inside(layout.player, width, height));
      assert.ok(layout.player.width >= 200 && layout.player.height >= 200, 'official player has at least a 200×200 viewport');
      if (mode === 'mini') for (const rect of panels) assert.equal(overlaps(rect, layout.player), false, `${rect.kind} covers the mini player`);
      else {
        assert.equal(layout.player.y, 72);
        assert.equal(layout.player.width, width);
        assert.equal(layout.player.height, height - 72);
        for (const rect of panels) assert.ok(rect.y + rect.height <= height - 80 - 16, `${rect.kind} covers native YouTube controls`);
      }
    });
  }
}

test('compact portrait keeps controls usable and folds auxiliary panels without horizontal overflow', () => {
  const layout = calculatePracticeLayout(390, 844, 'mini');
  assert.equal(layout.panels.controls.defaultMinimized, false);
  assert.equal(layout.panels.controls.size.height, 160);
  assert.equal(layout.panels.config.defaultMinimized, true);
  assert.equal(layout.panels.hint.defaultMinimized, true);
  assert.equal(layout.panels.config.position.y, layout.panels.hint.position.y);
  assert.ok(layout.panels.typing.size.height >= 160);
  assert.ok(layout.panels.subtitle.size.height >= 96);
  assert.ok(layout.player.y < layout.panels.controls.position.y);
  assert.ok(layout.panels.controls.position.y < layout.panels.typing.position.y);
  assert.ok(layout.panels.typing.position.y < layout.panels.subtitle.position.y);
});

test('desktop mini controls have room for playback and the additional web controls', () => {
  assert.equal(calculatePracticeLayout(1280, 720, 'mini').panels.controls.size.height, 210);
});

test('generic panel clamping fixes fresh offscreen defaults and honours an explicit minimum', () => {
  assert.deepEqual(clampPanelGeometry({ x: 2000, y: 2000 }, { width: 760, height: 520 }, { width: 240, height: 160 }, 800, 600), {
    position: { x: 40, y: 80 }, size: { width: 760, height: 520 },
  });
  assert.deepEqual(clampPanelGeometry({ x: -10, y: -20 }, { width: 20, height: 30 }, { width: 173, height: 96 }, 390, 844), {
    position: { x: 0, y: 0 }, size: { width: 173, height: 96 },
  });
});

test('a collapsed panel clamps its visible forty-pixel header while keeping its expanded size', () => {
  const closed = clampPanelGeometry({ x: 800, y: 650 }, { width: 350, height: 520 }, { width: 240, height: 160 }, 1280, 720, true);
  assert.deepEqual(closed, { position: { x: 800, y: 650 }, size: { width: 350, height: 520 } });
  const open = clampPanelGeometry(closed.position, closed.size, { width: 240, height: 160 }, 1280, 720, false);
  assert.deepEqual(open.position, { x: 800, y: 200 });
  assert.deepEqual(open.size, closed.size);
});

test('generic clamping handles narrow viewports and malformed persisted geometry safely', () => {
  const fit = clampPanelGeometry({ x: Infinity, y: NaN }, { width: -10, height: Infinity }, { width: 240, height: 160 }, 220, 300);
  assert.deepEqual(fit, { position: { x: 0, y: 0 }, size: { width: 204, height: 160 } });
});

test('layout calculation rejects non-finite viewport dimensions', () => {
  for (const [width, height] of [[0, 720], [1280, 0], [NaN, 720], [1280, Infinity]]) {
    assert.throws(() => calculatePracticeLayout(width, height, 'mini'), /Viewport/);
  }
});
