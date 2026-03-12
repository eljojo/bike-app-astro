/** Result from CSV parsing, matching the event result schema. */
export interface ParsedResult {
  brevet_no?: number;
  last_name: string;
  first_name?: string;
  time?: string;
  homologation?: string;
  status?: 'DNS' | 'DNF' | 'DQ';
}

/** Column name mappings — supports English and Spanish. */
const COLUMN_ALIASES: Record<string, string> = {
  // English
  brevet_no: 'brevet_no',
  last_name: 'last_name',
  first_name: 'first_name',
  time: 'time',
  homologation: 'homologation',
  status: 'status',
  // Spanish
  apellido: 'last_name',
  nombre: 'first_name',
  tiempo: 'time',
  homologacion: 'homologation',
  estado: 'status',
};

const STATUS_CODES = new Set(['DNS', 'DNF', 'DQ']);

/** Detect the delimiter used in a CSV string. */
function detectDelimiter(headerLine: string): string {
  if (headerLine.includes('\t')) return '\t';
  if (headerLine.includes(';')) return ';';
  return ',';
}

/** Parse a CSV string of event results into structured result objects. */
export function parseResultsCsv(csv: string): ParsedResult[] {
  const trimmed = csv.trim();
  if (!trimmed) return [];

  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const delimiter = detectDelimiter(headerLine);
  const rawHeaders = headerLine.split(delimiter).map(h => h.trim().toLowerCase());

  // Map raw headers to canonical names
  const headers = rawHeaders.map(h => COLUMN_ALIASES[h] || h);

  const results: ParsedResult[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(delimiter).map(v => v.trim());
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }

    // Skip empty rows (no last_name)
    if (!row.last_name) continue;

    const result: ParsedResult = { last_name: row.last_name };

    if (row.brevet_no) {
      const num = parseInt(row.brevet_no, 10);
      if (!isNaN(num)) result.brevet_no = num;
    }

    if (row.first_name) result.first_name = row.first_name;

    // Time field may contain a status code (DNS, DNF, DQ) instead of a time
    const timeValue = row.time || row.status || '';
    const upperTime = timeValue.toUpperCase();
    if (STATUS_CODES.has(upperTime)) {
      result.status = upperTime as ParsedResult['status'];
    } else if (timeValue) {
      result.time = timeValue;
    }

    if (row.homologation) result.homologation = row.homologation;

    results.push(result);
  }

  return results;
}
