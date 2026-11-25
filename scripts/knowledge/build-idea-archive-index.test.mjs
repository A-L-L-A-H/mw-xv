import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build, plain } from './build-idea-archive-index.mjs';

describe('build-idea-archive-index plain text sanitizer', () => {
  it('strips markdown formatting and HTML tags completely without multi-character collapse', () => {
    assert.equal(
      plain('  [**Link Title**](https://example.invalid) with `code`  '),
      'Link Title with code'
    );
    assert.equal(plain('<em>safe</em> text'), 'safe text');
    assert.equal(plain('<<b>>safe<</b>>'), 'safe');
    assert.equal(plain('<a><script'), 'script');
    assert.equal(plain('<scr<script>ipt>alert(1)</script>'), 'iptalert(1)');
    assert.equal(plain('<scr<script>ipt>alert(1)'), 'iptalert(1)');
    assert.equal(plain('prefix <script suffix > end'), 'prefix  end');
    assert.equal(plain('<<img src=x onerror=alert(1)>>'), '');
  });

  it('builds a deterministic index projection from the repository archive', async () => {
    const index = await build();
    assert.equal(index.format, 'moonwitness-idea-archive-index/v1');
    assert.ok(index.entries.length > 0);
  });
});
