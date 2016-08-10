import engine from 'engine.io';
import client from 'superagent';
import createDebug from 'debug';
import Redis from 'ioredis';
import { version } from '../package.json';
import server from './server';
import ChannelManager from './channel/manager';
import { has, set, unset } from './util';

const debug = createDebug('knock-server:log');
debug.error = createDebug('knock-server:error');

export default class Knock {
  static start(options) {
    return server(Knock, options);
  }

  /**
   * @param {http.Server} httpServer
   * @param {Redis} redis
   * @param {object} [options]
   */
  constructor(httpServer, redis, options = {}) {
    this.server = httpServer;
    this.redis = redis;
    this.cache = options.cache || new Redis({ host: options.host, port: options.port });
    this.manager = new ChannelManager();
    this.cacheExpires = options.cacheExpires || 86400;
    this.authAPI = options.authUrl || '/broadcasting/auth';

    // start engine server
    this.boot();
  }

  /**
   * @private
   */
  boot() {
    debug(`Knock Server Version ${version}`);

    this.engine = engine.attach(this.server, { path: '/zero' });

    // Listen to socket events.
    this.engine.on('open', (socket) => {
      socket.send('connected');
      socket.on('message', (data) => {
        const event = data.event;
        const channel = data.channel;

        if (event === 'subscribe') {
          if (this.requiresAuthentication(channel)) {
            this.authenticate(channel, data.auth, socket)
                .then(({ body }) => {
                  set(socket.member.channels, channel, { info: body, id: socket.member.id });
                  this.subscribe(channel, socket);
                })
                .catch(({ error, response }) => {
                  debug.error(`${channel} subscription error: ${socket.id}`);
                  debug.error(error || response);
                  this.send(socket, channel, {
                    event: 'subscription_error',
                    error: error || response.body.error,
                  });
                });
          } else {
            this.subscribe(channel, socket);
          }
        } else if (event === 'unsubscribe') {
          this.unsubscribe(channel, socket);
        }
      });

      socket.on('close', () => {
        this.manager.each((sockets, channel) => {
          if (has(sockets, socket.id)) {
            this.unsubscribe(channel, socket, false);
          }
        });
      });
    });

    // Listen to redis events.
    this.redis.psubscribe('*', () => {});

    this.redis.on('pmessage', (subscribed, channel, message) => {
      const { event, data, socket } = typeof message === 'string' ? JSON.parse(message) : message;

      debug(`${channel} send: ${event}`);
      this.manager.eachMember(channel, (memberSocket, memberSocketId) => {
        if (memberSocketId !== socket) {
          this.send(memberSocket, channel, { event, data });
        }
      });
    });
  }

  subscribe(channel, socket, confirm = true) {
    debug(`${channel} subscribe: ${socket.id}`);

    this.manager.join(channel, socket);
    if (confirm) this.send(socket, channel, 'subscribed');
    if (this.isPresenceChannel(channel)) this.joining(channel, socket);
  }

  unsubscribe(channel, socket, confirm = true) {
    debug(`${channel} unsubscribe: ${socket.id}`);

    if (this.isPresenceChannel(channel)) this.leaving(channel, socket);
    if (confirm) this.send(socket, channel, 'unsubscribed');

    unset(socket.member.channels, channel);
    this.manager.leave(channel, socket);
  }

  joining(channel, socket) {
    this.presence(socket, channel, 'member:added');
  }

  leaving(channel, socket) {
    this.presence(socket, channel, 'member:removed');
  }

  presence(channel, socket, event) {
    const members = this.manager.members(channel);

    this.send(channel, socket, {
      event,
      data: members,
    });
  }

  send(socket, channel, payload = {}) {
    let response = payload;
    if (typeof payload === 'string') response = { event: payload };
    if (!has(response, 'data')) response.data = {};
    response.channel = channel;
    socket.send(JSON.stringify(response));
  }

  authenticate(channel, credentials, socket) {
    return new Promise((resolve, reject) => {
      const key = `ws:auth:${channel}:${socket.member.id}`;

      this.cache.get(key)
          .then((result) => {
            if (result === 'false') {
              reject({ error: 'Authentication request failed.', response: null });
            } else {
              resolve({ body: JSON.parse(result) });
            }
          })
          .catch(() => {
            client.post(this.authAPI)
                .set(credentials.auth.headers)
                .send({ channel_name: channel, socket_id: socket.id })
                .end((error, response) => {
                  if (error || (response && response.status !== 200)) {
                    this.cache.set(key, 'false', 'EX', this.cacheExpires);
                    reject({ error, response });
                  }

                  this.cache.set(key, response.body, 'EX', this.cacheExpires);
                  resolve(response);
                });
          });
    });
  }

  isPrivateChannel(channel) {
    return channel.lastIndexOf('private-', 0) === 0;
  }

  isPresenceChannel(channel) {
    return channel.lastIndexOf('presence-', 0) === 0;
  }

  requiresAuthentication(channel) {
    return this.isPresenceChannel(channel) || this.isPrivateChannel(channel);
  }
}
