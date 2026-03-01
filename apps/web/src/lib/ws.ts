import { decodeServerEvent, encodeClientEvent, type ClientEvent, type ServerEvent } from "@arena/shared";

type Handlers = {
  onOpen?: () => void;
  onEvent: (event: ServerEvent) => void;
  onClose?: () => void;
  onError?: (message: string) => void;
};

export class WsClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelay = 1000;
  private closedByUser = false;

  constructor(
    private readonly url: string,
    private readonly handlers: Handlers,
  ) {}

  public connect(): void {
    this.closedByUser = false;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.handlers.onOpen?.();
    };

    this.ws.onmessage = (message) => {
      try {
        const event = decodeServerEvent(String(message.data));
        this.handlers.onEvent(event);
      } catch {
        this.handlers.onError?.("Invalid event from server");
      }
    };

    this.ws.onerror = () => {
      if (!this.closedByUser) this.handlers.onError?.(`WebSocket error: ${this.url}`);
    };

    this.ws.onclose = () => {
      this.handlers.onClose?.();
      if (!this.closedByUser) this.scheduleReconnect();
    };
  }

  public close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  public send(event: ClientEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(encodeClientEvent(event));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to encode WS event";
      this.handlers.onError?.(message);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.8, 8000);
  }
}
