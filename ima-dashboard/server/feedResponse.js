import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
const compress = promisify(gzip);

export function createFeedResponder(getFeed) {
  return async (req, res, next) => {
    try {
      const feed = getFeed();
      res.set('Cache-Control', 'no-store');
      if (!feed.length) {
        res.set('Retry-After', '2');
        return res.status(503).json({ error: 'Feed is warming up. Please retry.' });
      }
      // Compress the full feed without removing searchable text or stories.
      const body = JSON.stringify(feed);
      res.vary('Accept-Encoding');
      res.type('application/json');
      if (req.acceptsEncodings('gzip')) {
        res.set('Content-Encoding', 'gzip');
        return res.send(await compress(body));
      }
      return res.send(body);
    } catch (error) { next(error); }
  };
}
