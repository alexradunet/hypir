import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { parseRecoveryStatus, type RecoveryStatus } from '../../recovery/src/contract';
import { fetchWithRecoveryAuth, normalizeEndpoint, type DaemonConnection } from './transport';

type Action = 'status' | 'start' | 'stop' | 'recover';
const failures = {
  'startup-failed':
    'The retained backend could not start. Check the registered project and whether its port is occupied.',
  'readiness-timeout': 'The backend did not become ready before the deadline.',
  'backend-exited': 'The backend process exited unexpectedly.',
  'backend-unavailable': 'The backend process is not answering requests.',
  'stop-failed': 'The backend could not be stopped. Inspect the host process before retrying.',
};

// Stable host controls: always outside the backend-driven renderer and normal
// connection lifetime. Connection loss never queues or repeats a lifecycle write.
export function RecoveryControls({
  configureConnection,
  clearTokenOnConnect,
}: {
  configureConnection: (connection: DaemonConnection) => Promise<DaemonConnection>;
  clearTokenOnConnect: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:4748');
  const [token, setToken] = useState('');
  const [connection, setConnection] = useState<DaemonConnection>();
  const [status, setStatus] = useState<RecoveryStatus>();
  const [message, setMessage] = useState(
    'Connect to the independent recovery base to inspect the backend.',
  );
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const connectionAttempt = useRef(0);
  const pendingAction = useRef<Action>();
  const pending = useRef<AbortController>();
  const inFlight = useRef(false);
  const foreground = useRef(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );

  const request = useCallback(
    async (action: Action) => {
      if (!connection || !foreground.current) return;
      if (inFlight.current) {
        if (action === 'status' || pendingAction.current !== 'status') return;
        // An explicit action can supersede a read, never another lifecycle write.
        generation.current += 1;
        pending.current?.abort();
      }
      inFlight.current = true;
      pendingAction.current = action;
      const id = generation.current;
      const controller = new AbortController();
      pending.current = controller;
      const timer = setTimeout(() => controller.abort(), 12000);
      if (action !== 'status') setBusy(true);
      try {
        const response = await fetchWithRecoveryAuth(
          connection,
          `${connection.endpoint}/recovery/v1/${action}`,
          {
            method: action === 'status' ? 'GET' : 'POST',
            signal: controller.signal,
          },
        );
        if (id !== generation.current) return;
        if (response.status !== 200 && response.status !== 503) {
          setStatus(undefined);
          setMessage(
            response.status === 401 || response.status === 403
              ? 'Recovery rejected the credentials. Check the recovery token and connect again.'
              : 'The lifecycle action could not complete. Inspect status before retrying.',
          );
          return;
        }
        const value: unknown = await response.json();
        if (id !== generation.current) return;
        try {
          const next = parseRecoveryStatus(value);
          setStatus(next);
          setMessage(
            next.state === 'running'
              ? 'Backend ready. The normal workspace can reconnect.'
              : `Backend ${next.state}.`,
          );
        } catch {
          setStatus(undefined);
          setMessage(
            'Incompatible recovery response or version. Update the recovery base and host separately.',
          );
        }
      } catch {
        if (id !== generation.current) return;
        setStatus(undefined);
        setMessage(
          action === 'status'
            ? 'Recovery unavailable. Start the independent base; if Android stopped Termux, reopen Termux first.'
            : 'Action outcome unknown. Inspect status before trying again; the action will not be replayed.',
        );
      } finally {
        clearTimeout(timer);
        if (id === generation.current) {
          inFlight.current = false;
          pending.current = undefined;
          pendingAction.current = undefined;
          setBusy(false);
        }
      }
    },
    [connection],
  );

  useEffect(() => {
    void request('status');
    const timer = setInterval(() => {
      void request('status');
    }, 2000);
    const subscription = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active';
      if (foreground.current) void request('status');
      else pending.current?.abort();
    });
    return () => {
      generation.current += 1;
      pending.current?.abort();
      pending.current = undefined;
      inFlight.current = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [request]);

  useEffect(
    () => () => {
      connectionAttempt.current += 1;
    },
    [],
  );

  const connect = async () => {
    const id = ++connectionAttempt.current;
    generation.current += 1;
    pending.current?.abort();
    inFlight.current = false;
    setBusy(true);
    setStatus(undefined);
    setConnection(undefined);
    try {
      const candidate = { endpoint: normalizeEndpoint(endpoint), token: token.trim() };
      if (!/^[\x21-\x7e]{1,4096}$/.test(candidate.token)) throw new Error('Invalid token');
      const configured = await configureConnection(candidate);
      if (id !== connectionAttempt.current) return;
      setConnection(configured);
      setMessage('Inspecting recovery status…');
      if (clearTokenOnConnect) setToken('');
    } catch {
      if (id !== connectionAttempt.current) return;
      setMessage(
        'Could not configure recovery. Use an HTTP(S) origin and a nonempty recovery token.',
      );
    } finally {
      if (id === connectionAttempt.current) setBusy(false);
    }
  };

  return (
    <View style={styles.panel}>
      <Button
        title={expanded ? 'Hide backend recovery' : 'Backend recovery'}
        onPress={() => setExpanded(!expanded)}
        color="#41630b"
      />
      {expanded ? (
        <ScrollView style={styles.controls} keyboardShouldPersistTaps="handled">
          <TextInput
            accessibilityLabel="Recovery URL"
            style={styles.input}
            value={endpoint}
            onChangeText={setEndpoint}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TextInput
            accessibilityLabel="Recovery token"
            placeholder="Recovery token (required, memory only)"
            placeholderTextColor="#87909b"
            style={styles.input}
            value={token}
            onChangeText={setToken}
            editable={!busy}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            importantForAutofill="no"
          />
          <Button
            title="Connect recovery"
            onPress={() => {
              void connect();
            }}
            disabled={busy}
            color="#41630b"
          />
          <Text style={styles.text} accessibilityLiveRegion="polite">
            {message}
          </Text>
          {status ? (
            <>
              <Text style={styles.text}>
                Retained baseline: {status.baselineRevision.slice(0, 12)}
                {status.pid ? ` · process ${status.pid}` : ''}
              </Text>
              {status.failure ? (
                <Text style={styles.failure}>Last failure: {failures[status.failure]}</Text>
              ) : null}
            </>
          ) : null}
          <View style={styles.actions}>
            <Button
              title="Inspect"
              disabled={!connection || busy}
              onPress={() => {
                void request('status');
              }}
            />
            <Button
              title="Start backend"
              disabled={!status || busy}
              onPress={() => {
                void request('start');
              }}
            />
            <Button
              title="Stop backend"
              disabled={!status || busy}
              onPress={() => {
                void request('stop');
              }}
            />
            <Button
              title="Recover baseline"
              disabled={!status || busy}
              onPress={() => {
                void request('recover');
              }}
            />
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { paddingHorizontal: 10, paddingBottom: 6, backgroundColor: '#0e1319' },
  controls: { maxHeight: 280 },
  input: {
    color: '#f2f5f1',
    backgroundColor: '#18202a',
    padding: 8,
    borderRadius: 4,
    marginTop: 6,
    marginBottom: 4,
    fontSize: 12,
  },
  text: { color: '#b8c0c7', fontSize: 12, marginVertical: 5 },
  failure: { color: '#ff9977', fontSize: 12, marginBottom: 5 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 8 },
});
