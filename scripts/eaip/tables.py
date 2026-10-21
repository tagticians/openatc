"""Extract every table from an LVNL eAIP HTML page as rows of cell texts,
tagged with the most recent heading (h1-h5 / T*_default titles) above it.

Usage: python3 -I tables.py <page.html> <out.json>
"""
import html
import json
import re
import sys
from html.parser import HTMLParser


class TableGrab(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.heading = ''
        self.in_heading = 0
        self.head_buf = []
        self.stack = []  # nested tables: list of {rows, row, cell}
        self.tables = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5'):
            self.in_heading += 1
            self.head_buf = []
        if tag == 'table':
            self.stack.append({'rows': [], 'row': None, 'cell': None, 'heading': self.heading})
        elif self.stack:
            t = self.stack[-1]
            if tag == 'tr':
                t['row'] = []
            elif tag in ('td', 'th'):
                t['cell'] = []
                t['colspan'] = int(a.get('colspan') or 1)
            elif tag == 'br' and t['cell'] is not None:
                t['cell'].append('\n')

    def handle_endtag(self, tag):
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5') and self.in_heading:
            self.in_heading -= 1
            h = re.sub(r'\s+', ' ', ''.join(self.head_buf)).strip()
            if h:
                self.heading = h
        if not self.stack:
            return
        t = self.stack[-1]
        if tag in ('td', 'th') and t['cell'] is not None:
            txt = ''.join(t['cell'])
            txt = re.sub(r'[ \t\xa0]+', ' ', txt)
            txt = re.sub(r' *\n *', '\n', txt).strip()
            if t['row'] is not None:
                t['row'].append(txt)
            t['cell'] = None
        elif tag == 'tr' and t['row'] is not None:
            if any(c for c in t['row']):
                t['rows'].append(t['row'])
            t['row'] = None
        elif tag == 'table':
            done = self.stack.pop()
            if done['rows']:
                self.tables.append({'heading': done['heading'], 'rows': done['rows']})

    def handle_data(self, data):
        if self.in_heading:
            self.head_buf.append(data)
        if self.stack and self.stack[-1]['cell'] is not None:
            self.stack[-1]['cell'].append(data)


def extract(path):
    p = TableGrab()
    p.feed(open(path, encoding='utf-8', errors='ignore').read())
    return p.tables


if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    tables = extract(src)
    json.dump(tables, open(out, 'w'), indent=0, ensure_ascii=False)
    print(len(tables), 'tables')
