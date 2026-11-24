import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DOC = readFileSync(new URL('../sdlc/08.ui-design/20.pages/01.observatory.md', import.meta.url), 'utf8');
const GRID = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/observatory/components/request-grid.component.ts', import.meta.url), 'utf8');
const PAGE = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/observatory/pages/observatory.page.ts', import.meta.url), 'utf8');
const REQ = readFileSync(new URL('../eso/control-plane/src/modules/requests/request.service.ts', import.meta.url), 'utf8');

test('§0.3 documents the 8 interaction rules the operator asked about', () => {
  for (const needle of [
    'Default consumer', 'Live pulse — Play', 'Grid `Stream`', 'Group by conversation',
    'IDE selection color', 'Graph `Workers` / `3D offices`', 'Collapse / expand', 'Source types',
  ]) assert.ok(DOC.includes(needle), `doc thiếu: ${needle}`);
});

test('IDE colors in doc match HOST_META in code', () => {
  const meta = GRID.slice(GRID.indexOf('const HOST_META'), GRID.indexOf('};', GRID.indexOf('const HOST_META')));
  for (const [host, color] of Object.entries({ cursor: '#22d3ee', antigravity: '#c084fc', claude: '#f59e0b', codex: '#4ec97a', dsh: '#5aa9ff', orca: '#f472b6', paseo: '#2dd4bf' })) {
    assert.match(meta, new RegExp(`${host}: \\{ label: '[^']+', color: '${color}'`), `HOST_META ${host}`);
    assert.ok(DOC.includes(color), `doc thiếu màu ${host} ${color}`);
  }
});

test('group is open by default and Stream scrolls to live pulse', () => {
  assert.match(GRID, /<details class="request-group"[\s\S]{0,120} open>/);
  assert.match(PAGE, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
});

test('source labels derive from child + subagentKind in the backend', () => {
  assert.match(REQ, /const source = child \? \(declaredKind === 'swarm' \? 'swarm' : 'subagent'\) : 'agent'/);
  assert.match(REQ, /sourceLabel: child \? `\$\{sourcePrefix\}-\$\{workerId\.replace\(\/\^worker-\/, ''\)\}` : 'agent'/);
});
