import Http from 'http';
import dotEnv from 'dotenv';
import Redis from 'ioredis';
import createDebug from 'debug';
import path from 'path';

export default function (Server, config = {}) {
  if (path.existsSync('./.env')) {
    dotEnv.config({ path: './.env' });
  }

  const debug = createDebug('knock-server:log');
  const env = process.env;
  let options = config || {};

  if (!config || config.env !== false) {
    options = Object.assign(options, {
      cacheExpires: env.KNOCK_CACHE_EXPIRES,
      authUrl: env.BROADCASTING_AUTH_URL,
      host: env.BROADCASTING_HOST || 'localhost',
      port: env.BROADCASTING_PORT || 6379,
    });
  }

  const httpServer = new Http.Server((request, response) => {
    response.status(404).end();
  }).listen(env.KNOCK_SERVER_PORT || 3000, () => {
    debug(`listening on port: ${env.KNOCK_SERVER_PORT || 3000}.`);
  });

  const redis = options.redis || new Redis({ host: options.host, port: options.port });

  return new Server(httpServer, redis, options);
}
