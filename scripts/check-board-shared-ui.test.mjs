import assert from 'node:assert/strict';
import test from 'node:test';
import { findBoardUiViolations } from './check-board-shared-ui.mjs';

test('raw Board form controls fail with a location, replacement, and rerun command', () => {
  const violations = findBoardUiViolations(
    'export function Form() {\n  return <><button /><input /><select /><textarea /></>;\n}',
    'apps/board/src/form.tsx'
  );

  assert.equal(violations.length, 4);
  assert.match(violations[0], /apps\/board\/src\/form\.tsx:2: raw JSX <button>/u);
  assert.match(violations[0], /use Button from @moonwitness\/ui\/components\/button/u);
  assert.match(violations[0], /pnpm board:ui:check/u);
  assert.match(violations[1], /use Input or Checkbox/u);
  assert.match(violations[2], /use SelectField/u);
  assert.match(violations[3], /use Textarea/u);
});

test('text, comments, and components with shared names are not treated as native controls', () => {
  const source = `
    // <button> and @moonwitness/ui/dist/components/button
    const message = '<input /> <select /> <textarea />';
    export function Form() { return <><Button /><Input /><Select /><Textarea />{message}</>; }
  `;

  assert.deepEqual(findBoardUiViolations(source), []);
});

test('internal UI dist imports fail but public subpaths pass', () => {
  const violations = findBoardUiViolations(`
    import { Button } from '@moonwitness/ui/dist/components/button.js';
    export * from '@moonwitness/ui/dist/components/input.js';
    const lazy = import('@moonwitness/ui/dist/components/select.js');
    const legacy = require('@moonwitness/ui/dist/components/textarea.js');
    import { Input } from '@moonwitness/ui/components/input';
  `);

  assert.equal(violations.length, 4);
  assert.ok(violations.every((violation) => /public @moonwitness\/ui subpath/u.test(violation)));
  assert.ok(violations.every((violation) => /pnpm board:ui:check/u.test(violation)));
});

test('banned icon library imports fail with canonical icon guidance', () => {
  const violations = findBoardUiViolations(
    `
    import { Check } from 'lucide-react';
    import { BeakerIcon } from '@heroicons/react/24/outline';
    import { FiPlus } from 'react-icons/fi';
    import { Camera } from 'react-feather';
  `,
    'apps/board/src/icons.tsx'
  );

  assert.equal(violations.length, 4);
  assert.match(
    violations[0],
    /apps\/board\/src\/icons\.tsx:2: direct icon library import 'lucide-react'/u
  );
  assert.match(violations[1], /direct icon library import '@heroicons\/react\/24\/outline'/u);
  assert.match(violations[2], /direct icon library import 'react-icons\/fi'/u);
  assert.match(violations[3], /direct icon library import 'react-feather'/u);
  assert.ok(violations.every((violation) => /@moonwitness\/ui\/icons\/\*/u.test(violation)));
  assert.ok(violations.every((violation) => /pnpm board:ui:check/u.test(violation)));
});

test('raw JSX <svg> fails with shared asset guidance', () => {
  const violations = findBoardUiViolations(
    'export function Icon() {\n  return <><svg viewBox="0 0 10 10"><path d="M0 0" /></svg><svg /></>;\n}',
    'apps/board/src/icon.tsx'
  );

  assert.equal(violations.length, 2);
  assert.match(violations[0], /apps\/board\/src\/icon\.tsx:2: raw JSX <svg> is not allowed/u);
  assert.match(violations[1], /apps\/board\/src\/icon\.tsx:2: raw JSX <svg> is not allowed/u);
  assert.ok(violations.every((violation) => /@moonwitness\/ui\/icons/u.test(violation)));
  assert.ok(
    violations.every((violation) => /@moonwitness\/ui\/components\/effects/u.test(violation))
  );
  assert.ok(violations.every((violation) => /@moonwitness\/assets/u.test(violation)));
  assert.ok(violations.every((violation) => /pnpm board:ui:check/u.test(violation)));
});
