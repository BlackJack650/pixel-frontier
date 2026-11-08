/**
 * Transport-neutral room host contract. V0.1 uses RoomManager directly in one process.
 * A future master process can route roomId to workers implementing this same surface
 * without changing GameRoom simulation or the WebSocket protocol.
 */
export class IGameServer {
  async createRoom(_mode, _settings) { throw new Error('Not implemented'); }
  async findRoom(_roomId) { throw new Error('Not implemented'); }
  async listRooms() { throw new Error('Not implemented'); }
  async closeRoom(_roomId) { throw new Error('Not implemented'); }
}

/** Optional V0.2 lobby bus adapter; deliberately not required for local V0.1. */
export class LobbyBus {
  async publish(_channel, _message) { throw new Error('Optional Redis pub/sub adapter is not configured'); }
  async subscribe(_channel, _handler) { throw new Error('Optional Redis pub/sub adapter is not configured'); }
}
