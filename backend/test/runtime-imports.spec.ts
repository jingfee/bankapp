import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/** Every `.ts` file under `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  );
}

describe('runtime imports', () => {
  // The production image has no @bankapp/shared (it is not a dependency at runtime), so backend
  // code may import only types from it; a value import crashes the container at startup.
  it('never require @bankapp/shared from compiled backend code', () => {
    const offenders = sources(join(__dirname, '../src')).filter((file) => {
      const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
      });
      return /require\(["']@bankapp\/shared["']\)/.test(outputText);
    });

    expect(offenders).toEqual([]);
  });
});
