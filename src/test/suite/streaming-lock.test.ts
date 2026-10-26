import * as assert from 'assert';

import { streamAgent } from '../../bos/infrastructure/ai/streaming.js';

interface FakeOptions {
  tokens?: string[];
  /** 1-based call number that should fail before yielding anything. */
  failOnCall?: number;
  onEnter?: () => void;
  /** Paired with onEnter: lets a test hold a call open until a second one enters. */
  hold?: Promise<void>;
}

interface FakeState {
  busy: boolean;
  concurrent: number;
  maxConcurrent: number;
  calls: number;
}

/**
 * A stand-in for a jsbos agent: it refuses a second concurrent run with the
 * message the runtime uses, and it records how many runs overlapped.
 */
function makeFake(options: FakeOptions = {}): { agent: any; state: FakeState } {
  const tokens = options.tokens ?? ['ok'];
  const state: FakeState = { busy: false, concurrent: 0, maxConcurrent: 0, calls: 0 };

  const agent = {
    // eslint-disable-next-line require-yield
    async *streamEvents(): AsyncGenerator<any> {
      if (state.busy) throw new Error('Agent is already running');
      state.calls += 1;
      const call = state.calls;
      state.busy = true;
      state.concurrent += 1;
      state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent);
      try {
        if (options.onEnter) options.onEnter();
        if (options.hold) await options.hold;
        if (options.failOnCall === call) throw new Error('model exploded');
        for (const text of tokens) {
          await new Promise((resolve) => setTimeout(resolve, 1));
          yield { type: 'token', token: { type: 'Text', text } };
        }
        yield { type: 'done' };
      } finally {
        state.concurrent -= 1;
        state.busy = false;
      }
    },
  };

  return { agent, state };
}

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    if (typeof (timer as any).unref === 'function') (timer as any).unref();
  });
}

describe('streamAgent scheduling', () => {
  it('queues a second submission to a busy agent instead of letting it be refused', async () => {
    const fake = makeFake({ tokens: ['a', 'b'] });

    const results = await Promise.all([
      streamAgent(fake.agent, 'first'),
      streamAgent(fake.agent, 'second'),
    ]);

    assert.deepStrictEqual(results, ['ab', 'ab']);
    assert.strictEqual(fake.state.calls, 2, 'both submissions reached the agent');
    assert.strictEqual(fake.state.maxConcurrent, 1, 'the agent never ran two streams at once');
  });

  it('keeps the queue moving after a failed call', async () => {
    const fake = makeFake({ tokens: ['ok'], failOnCall: 1 });
    let failure: unknown = null;

    const first = streamAgent(fake.agent, 'first').catch((error: Error) => {
      failure = error;
      return null;
    });
    const second = streamAgent(fake.agent, 'second');

    const [, secondResult] = await Promise.all([first, second]);

    assert.ok(failure instanceof Error, 'the first call reported its own failure');
    assert.strictEqual(secondResult, 'ok', 'the call behind it still ran');
    assert.strictEqual(fake.state.calls, 2);
  });

  it('fails a call that never settles instead of hanging the tool', async () => {
    const agent = {
      // eslint-disable-next-line require-yield
      async *streamEvents(): AsyncGenerator<any> {
        await new Promise(() => undefined);
      },
    };

    let failure: unknown = null;
    await streamAgent(agent as any, 'wedged', {}, { timeoutMs: 60 }).catch((error: unknown) => {
      failure = error;
    });

    assert.ok(failure instanceof Error, 'the call reported a failure');
    assert.match((failure as Error).message, /timed out after/);
  });

  it('lets the next call through after a timed-out one', async () => {
    let calls = 0;
    const agent = {
      // eslint-disable-next-line require-yield
      async *streamEvents(): AsyncGenerator<any> {
        calls += 1;
        if (calls === 1) await new Promise(() => undefined);
        yield { type: 'token', token: { type: 'Text', text: 'ok' } };
        yield { type: 'done' };
      },
    };

    await streamAgent(agent as any, 'hangs', {}, { timeoutMs: 60 }).catch(() => undefined);
    const second = await streamAgent(agent as any, 'works', {}, { timeoutMs: 1000 });

    assert.strictEqual(second, 'ok', 'the queue kept moving past the dead call');
    assert.strictEqual(calls, 2);
  });

  it('does not serialize distinct agents against each other', async () => {
    let entered = 0;
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const onEnter = () => {
      entered += 1;
      if (entered === 2) openGate();
    };

    const first = makeFake({ tokens: ['x'], onEnter, hold: gate });
    const second = makeFake({ tokens: ['y'], onEnter, hold: gate });

    const results = await Promise.race([
      Promise.all([streamAgent(first.agent, '1'), streamAgent(second.agent, '2')]),
      timeoutAfter(2000),
    ]);

    assert.deepStrictEqual(results, ['x', 'y']);
    assert.strictEqual(entered, 2, 'both agents were in flight at the same time');
  });
});
