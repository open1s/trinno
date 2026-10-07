import { describe, it, before } from 'mocha';
import { strict as assert } from 'assert';
import { ConfigurationError, TimeoutError, CancelledError } from '@open1s/ezbos';

/**
 * worker.ts emits these payloads to the webview on every failure path
 * (slash-dispatch, command execute, compact-stream, main chat). The
 * `code` field is what lets the panel distinguish a retryable timeout
 * from a hard configuration error without string-matching messages.
 */
describe('worker errorPayload (structured error emit)', () => {
  let errorPayload: (err: unknown) => { error: string; code?: string };

  before(async () => {
    errorPayload = (await import('../../bos/worker')).errorPayload;
  });

  it('attaches the ezbos code for typed errors', () => {
    assert.deepEqual(errorPayload(new ConfigurationError('bad config')),
      { error: 'bad config', code: 'CONFIGURATION' });
    assert.deepEqual(errorPayload(new TimeoutError('too slow')),
      { error: 'too slow', code: 'TIMEOUT' });
    assert.deepEqual(errorPayload(new CancelledError('user stop')),
      { error: 'user stop', code: 'CANCELLED' });
  });

  it('omits code for plain errors (legacy shape preserved)', () => {
    assert.deepEqual(errorPayload(new Error('plain')), { error: 'plain' });
    assert.equal('code' in errorPayload(new Error('plain')), false);
  });

  it('stringifies non-Error values', () => {
    assert.deepEqual(errorPayload('oops'), { error: 'oops' });
    assert.deepEqual(errorPayload(42), { error: '42' });
  });
});
