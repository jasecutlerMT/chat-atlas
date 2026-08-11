import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APP_DIR = dirname(fileURLToPath(import.meta.url));

// Local-only update endpoints. The browser page never talks to the internet;
// when the Update button is clicked, THIS server process (running on the
// user's own machine) fetches the new app code from the public mirror.
function atlasUpdatePlugin(): Plugin {
  let updating = false;
  return {
    name: 'atlas-update',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/__atlas', (req, res) => {
        const url = (req.url ?? '').split('?')[0];
        const json = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };

        if (url === '/version' && req.method === 'GET') {
          json(200, JSON.parse(readFileSync(join(APP_DIR, 'version.json'), 'utf8')));
          return;
        }

        if (url === '/update-check' && req.method === 'GET') {
          execFile('node', [join(APP_DIR, 'scripts', 'update.mjs'), '--check'], { timeout: 20_000 }, (err, stdout) => {
            if (err) {
              json(200, { local: JSON.parse(readFileSync(join(APP_DIR, 'version.json'), 'utf8')).version, remote: null });
              return;
            }
            res.setHeader('content-type', 'application/json');
            res.end(stdout.trim());
          });
          return;
        }

        if (url === '/update' && req.method === 'POST') {
          // A custom header a foreign web page cannot send without failing
          // CORS preflight — stops random sites poking this local endpoint.
          if (req.headers['x-atlas'] !== '1') {
            json(403, { ok: false, error: 'forbidden' });
            return;
          }
          if (updating) {
            json(409, { ok: false, error: 'already updating' });
            return;
          }
          updating = true;
          execFile('node', [join(APP_DIR, 'scripts', 'update.mjs')], { timeout: 600_000 }, (err, stdout, stderr) => {
            updating = false;
            json(err ? 500 : 200, { ok: !err, log: `${stdout}\n${stderr}`.trim() });
          });
          return;
        }

        json(404, { error: 'unknown' });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), atlasUpdatePlugin()],
});
