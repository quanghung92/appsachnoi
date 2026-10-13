/**
 * CORS proxy cho dev web: forward về Modal API và stream Google Drive audio.
 * Chạy: node cors-proxy.js
 * App web gọi:
 *  - http://<ip-pc>:3001/modal/... -> Modal API
 *  - http://<ip-pc>:3001/drive-stream?id=... (hoặc ?url=...) -> Google Drive MP3 stream
 */
const http = require('http');
const https = require('https');

const TARGET = 'linhsamiu--audioverse-batch-api.modal.run';
const PORT = 3001;

function streamDriveUrl(targetUrl, req, res, maxRedirects = 5) {
  if (maxRedirects <= 0) {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many redirects' }));
    }
    return;
  }

  const client = targetUrl.startsWith('https:') ? https : http;
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
  if (req.headers['range']) {
    headers['range'] = req.headers['range'];
  }

  client
    .get(targetUrl, { headers }, (proxyRes) => {
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        streamDriveUrl(proxyRes.headers.location, req, res, maxRedirects - 1);
        return;
      }

      const responseHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
        'Accept-Ranges': 'bytes',
        'Content-Type': proxyRes.headers['content-type'] || 'audio/mpeg',
      };
      if (proxyRes.headers['content-length']) {
        responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
      }
      if (proxyRes.headers['content-range']) {
        responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
      }

      res.writeHead(proxyRes.statusCode, responseHeaders);
      proxyRes.pipe(res);
    })
    .on('error', (err) => {
      console.error('[Drive Stream Error]', err.message);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Drive stream failed', message: err.message }));
      }
    });
}

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. Google Drive Audio Stream
  if (req.url.startsWith('/drive-stream')) {
    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const fileId = parsed.searchParams.get('id');
    const rawUrl = parsed.searchParams.get('url');

    let targetDriveUrl = '';
    if (fileId) {
      targetDriveUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    } else if (rawUrl) {
      targetDriveUrl = decodeURIComponent(rawUrl);
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing id or url param' }));
      return;
    }

    console.log(`[Drive Stream] ${targetDriveUrl}`);
    streamDriveUrl(targetDriveUrl, req, res);
    return;
  }

  // 2. Modal Batch API proxy
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

  proxyReq.setTimeout(30000, () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Gateway timeout' }));
    }
  });

  proxyReq.on('error', (e) => {
    console.error('Proxy error:', e.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'proxy failed', message: e.message }));
    }
  });

  if (req.method === 'GET' || req.method === 'HEAD') {
    proxyReq.end();
  } else {
    req.pipe(proxyReq);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CORS proxy chạy tại http://0.0.0.0:${PORT}/modal`);
  console.log(`Drive stream chạy tại http://0.0.0.0:${PORT}/drive-stream?id=...`);
});
