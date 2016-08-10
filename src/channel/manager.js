import { has, each } from '../util';

export default class ChannelManager {
  constructor() {
    this.channels = {};
  }

  channel(name) {
    if (!has(this.channels, name)) this.channels[name] = {};

    return this.channels[name];
  }

  each(callback) {
    each(this.channels, callback);
  }

  eachMember(channel, callback) {
    const items = this.channel(channel);
    each(items, callback);
  }

  join(channel, socket) {
    this.channel(channel)[socket.id] = socket;
  }

  leave(channel, socket) {
    delete this.channel(channel)[socket.id];
  }

  members(channel) {
    const current = channel;
    const members = {};
    const sockets = this.channels[current];
    each(sockets, (socket, id) => {
      members[id] = socket.member.channels[channel] || {};
      members[id].socket_ids = [id];
    });

    return members;
  }
}
