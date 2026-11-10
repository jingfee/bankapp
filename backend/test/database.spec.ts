import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DATABASE_FILE_NAME, openDatabase } from '../src/db/database';
import { banks } from '../src/db/schema';

describe('openDatabase', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bankapp-db-'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates the database in the data directory and runs migrations', () => {
    const dataDir = join(dir, 'nested', 'data');

    const { db, close } = openDatabase({ dataDir });

    expect(existsSync(join(dataDir, DATABASE_FILE_NAME))).toBe(true);
    expect(db.select().from(banks).all()).toEqual([]);
    close();
  });

  it('keeps data and tolerates already-applied migrations on restart', () => {
    const first = openDatabase({ dataDir: dir });
    first.db.insert(banks).values({ name: 'Skandia', country: 'SE' }).run();
    first.close();

    const second = openDatabase({ dataDir: dir });

    expect(second.db.select().from(banks).all()).toHaveLength(1);
    second.close();
  });
});
