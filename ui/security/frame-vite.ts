import type { Plugin } from 'vite';
import { parseFramePolicy, frameCSP } from './frame-policy.mjs';
export function framePolicyPlugin(): Plugin {
  const entries = parseFramePolicy();
  const install = (server: import('vite').ViteDevServer | import('vite').PreviewServer) => {
    server.middlewares.use((req, res, next) => {
      const existing=res.getHeader('Content-Security-Policy');
      res.setHeader('Content-Security-Policy',Array.isArray(existing)?existing.map(value=>frameCSP(entries,String(value))):frameCSP(entries,String(existing??'')));
      if (!entries.length) res.setHeader('X-Frame-Options', 'DENY'); else res.removeHeader('X-Frame-Options');
      if (req.url?.split('?')[0] !== '/frame-config.json') return next();
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({frameAllowedAncestors:entries}));
    });
  };
  return {name:'runtime-frame-policy',configureServer:install,configurePreviewServer:install};
}
