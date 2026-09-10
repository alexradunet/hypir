import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import EventSource from 'react-native-sse';
import {
  eventTypes,
  parseEvent,
  parseStatus,
  type DaemonEvent,
  type ProjectManifest,
  type WorkspaceSnapshot,
} from '@hypir/protocol';
import { daemonHeaders, fetchWithDaemonAuth, type DaemonConnection } from './transport';

// The SSE library can queue a poll *after* an error listener closes it. Make
// closure terminal so an already-dispatched callback cannot resurrect XHR.
class SessionEventSource<T extends string> extends EventSource<T> {
  private closed = false;

  override open(): void {
    if (!this.closed) super.open();
  }

  override close(): void {
    this.closed = true;
    super.close();
  }
}

type SessionState = {
  project?: ProjectManifest;
  workspace?: WorkspaceSnapshot['workspace'];
  generation: number;
  phase: 'connecting' | 'live' | 'offline' | 'error';
  message: string;
};

export function useDaemon(connection: DaemonConnection): SessionState & { disconnect: () => void } {
  const disconnectHandler = useRef<() => void>(() => {});
  const disconnect = useCallback(() => disconnectHandler.current(), []);
  const [state, setState] = useState<SessionState>({
    generation: 0,
    phase: 'connecting',
    message: 'Connecting to daemon…',
  });
  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let failures = 0;
    let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    let source: EventSource<DaemonEvent['type']> | undefined;
    let controller: AbortController | undefined;
    let retryTimer: number | undefined;
    let deadline: number | undefined;

    const stop = () => {
      attempt += 1;
      clearTimeout(retryTimer);
      clearTimeout(deadline);
      controller?.abort();
      source?.removeAllEventListeners();
      source?.close();
      source = undefined;
    };

    const fail = (message: string, fatal = false) => {
      if (disposed || !foreground) return;
      stop();
      setState((current) => ({ ...current, phase: fatal ? 'error' : 'offline', message }));
      if (!fatal) {
        const delay = Math.min(15000, 1000 * 2 ** Math.min(failures++, 4));
        retryTimer = setTimeout(connect, delay);
      }
    };

    disconnectHandler.current = () =>
      fail('Disconnected. The action outcome is unknown; reconnecting without replay.');

    const connect = async () => {
      if (disposed || !foreground) return;
      stop();
      const id = attempt;
      const current = () => !disposed && foreground && id === attempt;
      setState((previous) => ({
        ...previous,
        phase: 'connecting',
        message: 'Connecting to daemon…',
      }));
      controller = new AbortController();
      deadline = setTimeout(() => fail('Daemon timed out. Retrying…'), 10000);
      try {
        const response = await fetchWithDaemonAuth(
          connection,
          `${connection.endpoint}/api/status`,
          { signal: controller.signal },
        );
        if (!current()) return;
        if (!response.ok) {
          fail(
            `Daemon returned HTTP ${response.status}. ${response.status === 401 ? 'Check the token and reconnect.' : 'Retrying…'}`,
            response.status === 401 || response.status === 403,
          );
          return;
        }
        const json: unknown = await response.json();
        if (!current()) return;
        try {
          const status = parseStatus(json);
          setState((previous) => ({
            ...previous,
            project: status.project,
            workspace: status.workspace,
          }));
        } catch {
          fail(
            'Incompatible daemon status or protocol version. Update the daemon and reconnect.',
            true,
          );
          return;
        }
        clearTimeout(deadline);
        source = new SessionEventSource<DaemonEvent['type']>(`${connection.endpoint}/api/events`, {
          headers: daemonHeaders(connection),
          // Library polling handles clean EOF; errors (including status 0) are
          // retried explicitly below, since its onerror does not poll again.
          pollingInterval: 2000,
          timeoutBeforeConnection: 0,
        });
        let synchronized = false;
        const handshakeDeadline = () => {
          clearTimeout(deadline);
          deadline = setTimeout(() => fail('Event stream did not synchronize. Retrying…'), 10000);
        };
        handshakeDeadline();
        source.addEventListener('open', () => {
          if (!current()) return;
          synchronized = false;
          setState((previous) => ({
            ...previous,
            phase: 'connecting',
            message: 'Synchronizing workspace…',
          }));
          handshakeDeadline();
        });
        const receive = (type: DaemonEvent['type'], data: string | null) => {
          if (!current()) return;
          let event: DaemonEvent;
          try {
            event = parseEvent(data ?? '');
            if (event.type !== type) throw new Error('SSE event name does not match envelope');
            if (event.type !== eventTypes.connected && !synchronized)
              throw new Error('Missing connection handshake');
          } catch {
            fail(
              'Invalid event or incompatible protocol version. Update the daemon and reconnect.',
              true,
            );
            return;
          }
          if (event.type === eventTypes.connected) {
            clearTimeout(deadline);
            synchronized = true;
            failures = 0;
            // Never pin server revisions: each new stream obtains the current
            // manifest and advances our local generation, even after daemon restart.
            const project = event.payload.project;
            setState((previous) => ({
              project,
              workspace: event.payload.workspace,
              generation: previous.generation + 1,
              phase: 'live',
              message: `Live · ${project.name}`,
            }));
          } else if (event.type === eventTypes.workspaceChanged) {
            setState((previous) => ({
              ...previous,
              project: event.payload.project,
              workspace: event.payload.workspace,
              generation: previous.generation + 1,
            }));
          } else {
            setState((previous) => ({ ...previous, generation: previous.generation + 1 }));
          }
        };
        source.addEventListener(eventTypes.connected, (event) =>
          receive(eventTypes.connected, event.data),
        );
        source.addEventListener(eventTypes.workspaceChanged, (event) =>
          receive(eventTypes.workspaceChanged, event.data),
        );
        source.addEventListener(eventTypes.previewInvalidate, (event) =>
          receive(eventTypes.previewInvalidate, event.data),
        );
        source.addEventListener('message', () => {
          if (current())
            fail('Unexpected unnamed daemon event. Update the daemon and reconnect.', true);
        });
        source.addEventListener('error', (event) => {
          if (!current()) return;
          const status = event.type === 'error' ? event.xhrStatus : 0;
          fail(
            status === 401 || status === 403
              ? 'Event stream rejected credentials. Check the token and reconnect.'
              : 'Event stream disconnected. Retrying…',
            status === 401 || status === 403,
          );
        });
      } catch {
        if (current())
          fail('Daemon unreachable. Check its URL, port forwarding and network. Retrying…');
      }
    };

    const subscription = AppState.addEventListener('change', (next) => {
      const active = next === 'active';
      if (active === foreground) return;
      foreground = active;
      stop();
      if (active) {
        failures = 0;
        void connect();
      } else {
        setState((previous) => ({
          ...previous,
          phase: 'offline',
          message: 'Paused in background',
        }));
      }
    });
    if (foreground) void connect();
    return () => {
      disposed = true;
      disconnectHandler.current = () => {};
      stop();
      subscription.remove();
    };
  }, [connection]);
  return { ...state, disconnect };
}
