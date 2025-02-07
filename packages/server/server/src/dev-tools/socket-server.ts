import { Server } from 'http';
import { Socket } from 'net';
import ws from 'ws';
import type { Stats } from 'webpack';
import { logger } from '@modern-js/utils';
import { DevServerOptions } from '../type';
import { noop } from '../utils';

interface ExtWebSocket extends ws {
  isAlive: boolean;
}

export default class SocketServer {
  private wsServer!: ws.Server;

  private readonly sockets: ws[] = [];

  private readonly options: DevServerOptions;

  private app?: Server;

  private stats?: Stats;

  constructor(options: DevServerOptions) {
    this.options = options;
  }

  // create socket, install socket handler, bind socket event
  public prepare(app: Server) {
    this.app = app;

    this.wsServer = new ws.Server({
      noServer: true,
      path: this.options.client.path,
    });

    // listen upgrade event to handle socket
    this.app.on('upgrade', (req, sock, head) => {
      if (!this.wsServer.shouldHandle(req)) {
        return;
      }

      this.wsServer.handleUpgrade(req, sock as Socket, head, connection => {
        this.wsServer.emit('connection', connection, req);
      });
    });

    this.wsServer.on('error', (err: Error) => {
      // only dev server, use default logger
      logger.error(err);
    });

    setInterval(() => {
      this.wsServer.clients.forEach(socket => {
        const extWs = socket as ExtWebSocket;
        if (!extWs.isAlive) {
          extWs.terminate();
        } else {
          extWs.isAlive = false;
          extWs.ping(noop);
        }
      });
    }, 30000);

    this.wsServer.on('connection', socket => {
      const connection = socket as ExtWebSocket;

      connection.isAlive = true;
      connection.on('pong', () => {
        connection.isAlive = true;
      });

      if (!connection) {
        return;
      }

      this.sockets.push(connection);

      connection.on('close', () => {
        const idx = this.sockets.indexOf(connection);

        if (idx >= 0) {
          this.sockets.splice(idx, 1);
        }
      });

      if (this.options.client.logging) {
        this.sockWrite('logging', this.options.client.logging);
      }

      if (this.options.hot || this.options.hot === 'only') {
        this.sockWrite('hot');
      }

      if (this.options.liveReload) {
        this.sockWrite('liveReload');
      }

      if (this.options.client.progress) {
        this.sockWrite('progress', this.options.client.progress);
      }

      if (this.options.client.overlay) {
        this.sockWrite('overlay', this.options.client.overlay);
      }

      // send first stats to active client sock if stats exist
      if (this.stats) {
        this.sendStats(true);
      }
    });
  }

  public updateStats(stats: Stats) {
    this.stats = stats;
    this.sendStats();
  }

  // write message to each socket
  public sockWrite(
    type: string,
    data?: Record<string, any> | string | boolean,
  ) {
    this.sockets.forEach(socket => {
      this.send(socket, JSON.stringify({ type, data }));
    });
  }

  public close(connection: ws) {
    connection.close();
  }

  // get standard stats
  private getStats() {
    const curStats = this.stats;

    if (!curStats) {
      return null;
    }

    const defaultStats: Record<string, boolean> = {
      all: false,
      hash: true,
      assets: true,
      warnings: true,
      errors: true,
      errorDetails: false,
    };

    return curStats.toJson(defaultStats);
  }

  // determine what message should send by stats
  private sendStats(force = false) {
    const stats = this.getStats();

    // this should never happend
    if (!stats) {
      return null;
    }

    const shouldEmit =
      !force &&
      stats &&
      (!stats.errors || stats.errors.length === 0) &&
      stats.assets &&
      stats.assets.every((asset: any) => !asset.emitted);

    if (shouldEmit) {
      return this.sockWrite('still-ok');
    }

    this.sockWrite('hash', stats.hash);

    if (stats.errors && stats.errors.length > 0) {
      return this.sockWrite('errors', stats.errors);
    } else if (stats.warnings && stats.warnings.length > 0) {
      return this.sockWrite('warnings', stats.warnings);
    } else {
      return this.sockWrite('ok');
    }
  }

  // send message to connecting socket
  private send(connection: ws, message: string) {
    if (connection.readyState !== 1) {
      return;
    }

    connection.send(message);
  }
}
