/**
 * CORS proxy cho dev web: forward về Modal API.
 * Chạy: node cors-proxy.js
 * App web gọi http://<ip-pc>:3001/modal/... thay vì gọi trực tiếp Modal API.
 */
const http = require('http');
const https = require('https');

const TARGET = 'linhsamiu--audioverse-batch-api.modal.run';
const PORT = 3001;

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const targetPath = req.url.replace(/^\/modal/, '') || '/';
  console.log(`${req.method} ${req.url} -> https://${TARGET}${targetPath}`);

  const proxyReq = https.request(
    {
      hostname: TARGET,
      path: targetPath,
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (e) => {
    console.error('Proxy error:', e.message);
    res.writeHead(502);
    res.end(JSON.stringify({ error: 'proxy failed' }));
  });

  req.pipe(proxyReq);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CORS proxy chạy tại http://0.0.0.0:${PORT}/modal`);
  console.log(`Ví dụ: http://<ip-pc>:${PORT}/modal/status`);
});
