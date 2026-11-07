'use strict';
/**
 * A CSV reader that takes text in pieces, so a file far larger than memory can be read as it downloads.
 * Handles quoted fields, doubled quotes inside them, the delimiter and line breaks inside quotes, CRLF and LF.
 * feed() returns the rows completed so far; end() returns the last row if the file did not end with a line break.
 */
class CsvStream {
  constructor({ delimiter = ';' } = {}) {
    this.delimiter = delimiter;
    this.field = ''; this.row = []; this.quoted = false; this.afterQuote = false; this.started = false;
  }
  feed(text) {
    const rows = [], d = this.delimiter;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (this.quoted) {
        if (ch === '"') { this.quoted = false; this.afterQuote = true; } else this.field += ch;
        continue;
      }
      if (this.afterQuote && ch === '"') { this.field += '"'; this.quoted = true; this.afterQuote = false; continue; }   // "" inside a quoted field
      this.afterQuote = false;
      if (ch === '"' && this.field === '' && !this.started) { this.quoted = true; this.started = true; continue; }
      if (ch === d) { this.row.push(this.field); this.field = ''; this.started = false; continue; }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        this.row.push(this.field); this.field = ''; this.started = false;
        if (this.row.length > 1 || this.row[0] !== '') rows.push(this.row);
        this.row = [];
        continue;
      }
      this.started = true; this.field += ch;
    }
    return rows;
  }
  end() {
    if (this.field === '' && !this.row.length) return [];
    this.row.push(this.field); const r = this.row; this.field = ''; this.row = []; this.started = false; this.afterQuote = false;
    return [r];
  }
}
module.exports = { CsvStream };
