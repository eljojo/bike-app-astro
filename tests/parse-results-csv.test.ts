import { describe, it, expect } from 'vitest';
import { parseResultsCsv } from '../src/lib/parse-results-csv';

describe('parseResultsCsv', () => {
  it('parses finishers with English column names', () => {
    const csv = `brevet_no,last_name,first_name,time,homologation
1,Smith,John,12:30:00,ABC123
2,Doe,Jane,13:45:00,DEF456`;

    const results = parseResultsCsv(csv);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      brevet_no: 1,
      last_name: 'Smith',
      first_name: 'John',
      time: '12:30:00',
      homologation: 'ABC123',
    });
    expect(results[1]).toEqual({
      brevet_no: 2,
      last_name: 'Doe',
      first_name: 'Jane',
      time: '13:45:00',
      homologation: 'DEF456',
    });
  });

  it('parses DNS/DNF/DQ as status codes', () => {
    const csv = `brevet_no,last_name,first_name,time
1,Smith,John,DNF
2,Doe,Jane,DNS
3,Brown,Bob,DQ`;

    const results = parseResultsCsv(csv);
    expect(results[0]).toEqual({
      brevet_no: 1,
      last_name: 'Smith',
      first_name: 'John',
      status: 'DNF',
    });
    expect(results[1].status).toBe('DNS');
    expect(results[2].status).toBe('DQ');
  });

  it('handles mixed finishers and non-finishers', () => {
    const csv = `last_name,first_name,time
Smith,John,12:30:00
Doe,Jane,DNF
Brown,Bob,10:15:00`;

    const results = parseResultsCsv(csv);
    expect(results).toHaveLength(3);
    expect(results[0].time).toBe('12:30:00');
    expect(results[0].status).toBeUndefined();
    expect(results[1].time).toBeUndefined();
    expect(results[1].status).toBe('DNF');
    expect(results[2].time).toBe('10:15:00');
  });

  it('parses Spanish column names', () => {
    const csv = `apellido,nombre,tiempo,homologacion
García,Carlos,11:00:00,XYZ789`;

    const results = parseResultsCsv(csv);
    expect(results[0]).toEqual({
      last_name: 'García',
      first_name: 'Carlos',
      time: '11:00:00',
      homologation: 'XYZ789',
    });
  });

  it('filters out empty rows', () => {
    const csv = `last_name,first_name,time
Smith,John,12:30:00

,,
Brown,Bob,10:15:00
`;

    const results = parseResultsCsv(csv);
    expect(results).toHaveLength(2);
  });

  it('handles tabs as delimiter', () => {
    const csv = `last_name\tfirst_name\ttime
Smith\tJohn\t12:30:00`;

    const results = parseResultsCsv(csv);
    expect(results).toHaveLength(1);
    expect(results[0].last_name).toBe('Smith');
  });

  it('handles semicolons as delimiter', () => {
    const csv = `last_name;first_name;time
Smith;John;12:30:00`;

    const results = parseResultsCsv(csv);
    expect(results).toHaveLength(1);
    expect(results[0].last_name).toBe('Smith');
  });

  it('returns empty array for empty input', () => {
    expect(parseResultsCsv('')).toEqual([]);
    expect(parseResultsCsv('  ')).toEqual([]);
  });

  it('trims whitespace from values', () => {
    const csv = `last_name , first_name , time
 Smith , John , 12:30:00 `;

    const results = parseResultsCsv(csv);
    expect(results[0].last_name).toBe('Smith');
    expect(results[0].first_name).toBe('John');
    expect(results[0].time).toBe('12:30:00');
  });
});
