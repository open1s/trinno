import * as assert from 'assert';

describe('E2E: Model Switch — config propagation to ezbos AgentBuilder', function () {
  this.timeout(30000);

  let brain: any;
  let factory: any;

  before(async function () {
    const { BrainOS } = await import('@open1s/ezbos');
    const { initAgentFactory, getAgentFactory, resetAgentFactory } = await import(
      '../../bos/infrastructure/agent-factory.js'
    );

    // Create BrainOS without config.toml dependency
    brain = new BrainOS();
    await brain.start();
    initAgentFactory(brain);
    factory = getAgentFactory();
  });

  after(async function () {
    const { resetAgentFactory } = await import('../../bos/infrastructure/agent-factory.js');
    await resetAgentFactory();
  });

  it('preserves nvidia/ prefix in model sent to ezbos AgentBuilder', function () {
    const builder = factory.create({
      name: 'test',
      systemPrompt: 'test',
      model: 'nvidia/minimaxai/minimax-m2.7',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: 'nvapi-test-key',
    });

    const cfg = (builder as any)._config;
    assert.strictEqual(cfg.model, 'nvidia/minimaxai/minimax-m2.7',
      'nvidia/ prefix must survive to the ezbos AgentBuilder config');
    assert.strictEqual(cfg.baseUrl, 'https://integrate.api.nvidia.com/v1');
    assert.strictEqual(cfg.apiKey, 'nvapi-test-key');
  });

  it('propagates model/baseUrl/apiKey when switching to a different provider', function () {
    const builder = factory.create({
      name: 'test',
      systemPrompt: 'test',
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test-key',
    });

    const cfg = (builder as any)._config;
    assert.strictEqual(cfg.model, 'gpt-4o');
    assert.strictEqual(cfg.baseUrl, 'https://api.openai.com/v1');
    assert.strictEqual(cfg.apiKey, 'sk-test-key');
  });

  it('propagates multi-segment provider prefix', function () {
    const builder = factory.create({
      name: 'test',
      systemPrompt: 'test',
      model: 'openrouter/anthropic/claude-3-opus',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'or-test-key',
    });

    const cfg = (builder as any)._config;
    assert.strictEqual(cfg.model, 'openrouter/anthropic/claude-3-opus');
  });

  it('uses BrainOS default apiKey when none provided in create()', function () {
    // The BrainOS was created with no explicit apiKey, so start()
    // resolved it from config.toml (or undefined). We verify that
    // omitting apiKey from create() does NOT override the BrainOS default.
    const builder = factory.create({
      name: 'test',
      systemPrompt: 'test',
    });

    const cfg = (builder as any)._config;
    // Should NOT be undefined — BrainOS set it from its _options
    assert.ok(cfg.apiKey !== undefined,
      'apiKey should come from BrainOS default when not passed explicitly');
  });

  it('create() model overrides BrainOS default model', function () {
    const builder = factory.create({
      name: 'test',
      systemPrompt: 'test',
      model: 'anthropic/claude-sonnet-4',
      baseUrl: 'https://api.anthropic.com/v1',
    });

    const cfg = (builder as any)._config;
    assert.strictEqual(cfg.model, 'anthropic/claude-sonnet-4');
    assert.strictEqual(cfg.baseUrl, 'https://api.anthropic.com/v1');
  });

  it('sequential create() with same model but different apiKeys keeps each apiKey correctly', function () {
    const keyA = 'nvapi-test-a';
    const keyB = 'nvapi-test-b';

    const builder1 = factory.create({
      name: 'test',
      systemPrompt: 'test',
      model: 'nvidia/my-model',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: keyA,
    });

    const cfg1 = (builder1 as any)._config;
    assert.strictEqual(cfg1.apiKey, keyA,
      'first create() must have apiKey A');

    const builder2 = factory.create({
      name: 'test',
      systemPrompt: 'test',
      model: 'nvidia/my-model',  // same model as first
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: keyB,               // different apiKey
    });

    const cfg2 = (builder2 as any)._config;
    assert.strictEqual(cfg2.apiKey, keyB,
      'second create() must NOT reuse apiKey A from first create()');
  });

  it('propagates apiMode/reasoningEffort to ezbos AgentBuilder config', function () {
    const builder = factory.create({
      name: 'test',
      systemPrompt: 'test',
      model: 'nvidia/deepseek-ai/deepseek-v4-pro',
      baseUrl: 'http://127.0.0.1:11436/v1',
      apiKey: 'nvapi-test-key',
      apiMode: 'responses',
      reasoningEffort: 'high',
    });

    const cfg = (builder as any)._config;
    assert.strictEqual(cfg.apiMode, 'responses',
      'apiMode must reach the ezbos AgentBuilder config');
    assert.strictEqual(cfg.reasoningEffort, 'high',
      'reasoningEffort must reach the ezbos AgentBuilder config');
  });

  it('omits apiMode/reasoningEffort when not provided', function () {
    const builder = factory.create({
      name: 'test',
      systemPrompt: 'test',
      model: 'gpt-4o',
    });

    const cfg = (builder as any)._config;
    assert.strictEqual(cfg.apiMode, undefined,
      'apiMode should stay undefined when not provided (falls back to engine default)');
    assert.strictEqual(cfg.reasoningEffort, undefined,
      'reasoningEffort should stay undefined when not provided');
  });
});
