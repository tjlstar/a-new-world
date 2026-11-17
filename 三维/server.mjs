// 本地静态服务:node 三维/server.mjs [--open]。浏览器不能直接用 file:// 打开模块和数据文件,所以需要它。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4174);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8' };

http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}/`;
  console.log(`岛屿三维漫游已启动: ${url}\n关闭此窗口即可停止。`);
  if (process.argv.includes('--open')) exec(process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`);
});
