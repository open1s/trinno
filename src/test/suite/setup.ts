// Alias TDD globals (suite/test) to BDD globals (describe/it) so test files can use either style.
declare const describe: any;
declare const it: any;
declare const before: any;
declare const after: any;
declare const beforeEach: any;
declare const afterEach: any;

(globalThis as any).suite = (name: string, fn: any) => (globalThis as any).describe(name, fn);
(globalThis as any).test = (name: string, fn: any) => (globalThis as any).it(name, fn);
(globalThis as any).suiteSetup = (fn: any) => (globalThis as any).before(fn);
(globalThis as any).suiteTeardown = (fn: any) => (globalThis as any).after(fn);
(globalThis as any).setup = (fn: any) => (globalThis as any).beforeEach(fn);
(globalThis as any).teardown = (fn: any) => (globalThis as any).afterEach(fn);

export {};
