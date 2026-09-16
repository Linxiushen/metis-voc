import { DatabaseSync } from "node:sqlite";

export class SQLiteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.beforeStatement = null;
  }

  prepare(sql) {
    const statement = {
      sql,
      args: [],
      bind(...args) { this.args = args; return this; },
      runSync: () => {
        this.beforeStatement?.(sql, statement.args);
        const result = this.sqlite.prepare(sql).run(...statement.args);
        return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
      async run() { return this.runSync(); },
      first: async () => this.sqlite.prepare(sql).get(...statement.args) || null,
      all: async () => ({ results: this.sqlite.prepare(sql).all(...statement.args) }),
    };
    return statement;
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  close() { this.sqlite.close(); }
}
