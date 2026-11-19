'use strict';

const fs = require('node:fs');
const path = require('node:path');

const pages = {
  '/arus/analysis': { file: 'precision-entry.html', label: 'Signal & Carta' },
  '/arus/auto-trade': { file: 'auto-trade.html', label: 'Auto Trade' },
  '/arus/ib': { file: 'ib.html', label: 'Pasukan IB' },
  '/arus/ib/telegram': { file: 'ib-telegram.html', label: 'Telegram IB' }
};

const aliases = {
  '/app': '/arus',
  '/analysis': '/arus/analysis',
  '/auto-trade': '/arus/auto-trade',
  '/ib': '/arus/ib',
  '/ib/telegram': '/arus/ib/telegram'
};

function pageFor(pathname, role) {
  if (pathname === '/arus') return { redirect: role === 'ib' ? '/arus/ib' : '/arus/analysis' };
  if (!Object.hasOwn(pages, pathname)) return null;
  if (pathname.startsWith('/arus/ib') && role !== 'ib') return null;
  return pages[pathname];
}

function render(page, role) {
  const links = [
    ['/arus/analysis', 'Signal & Carta'],
    ['/arus/analysis#alerts', 'Signal Telegram'],
    ['/arus/auto-trade', 'Auto Trade'],
    ...(role === 'ib' ? [['/arus/ib', 'Pasukan IB'], ['/arus/ib/telegram', 'Telegram IB']] : [])
  ];
  const nav = '<header class="arus-bar"><a class="arus-brand" href="/arus">Arus Trade Desk</a><nav aria-label="Arus Trade Desk">' +
    links.map(([href, text]) => '<a href="' + href + '">' + text + '</a>').join('') + '</nav></header>';
  return fs.readFileSync(path.join(__dirname, page.file), 'utf8')
    .replace(/<title>[^<]*<\/title>/i, '<title>' + page.label.replace('&', '&amp;') + ' | Arus Trade Desk</title>')
    .replace(/href="(\/[^"?#]*)([?#][^"]*)?"/g, (original, route, suffix = '') =>
      Object.hasOwn(aliases, route) ? 'href="' + aliases[route] + suffix + '"' : original)
    .replace('</head>', '<link rel="stylesheet" href="/arus/theme.css"></head>')
    .replace(/<body([^>]*)>/i, '<body$1>' + nav)
    .replace('ZENCORE / ANALYSIS WORKSPACE', 'ARUS / SIGNAL &amp; CARTA');
}

module.exports = { pageFor, render };
