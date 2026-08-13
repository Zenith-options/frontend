// Minimal CSV serialization — no external dependency needed for the shapes
// this app exports (flat objects, no embedded newlines in values).

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map(c => escape(c.header)).join(",");
  const lines = rows.map(row => columns.map(c => escape(c.value(row))).join(","));
  return [header, ...lines].join("\n");
}
