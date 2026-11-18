import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const host = '0.0.0.0';

const app = express();

app.use(
  express.static(join(__dirname, '三维'), {
    setHeaders: (res, filePath) => {
      res.setHeader('Cache-Control', 'no-store');
      if (filePath.endsWith('.mjs') || filePath.endsWith('.js')) {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      }
    },
  })
);

app.use(
  express.static(__dirname, {
    index: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store');
    },
  })
);

app.listen(port, host, () => {
  console.log(`岛屿基地三维漫游服务已启动: http://${host}:${port}/`);
});
