import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import Hyperview from 'hyperview';
import { format } from 'date-fns';
import { DAEMON_URL } from './config';
import {
  fetchWithDaemonAuth,
  normalizeEndpoint,
  requestUrl,
  type DaemonConnection,
} from './transport';
import { useDaemon } from './useDaemon';

type RequestRecord = { method: string; url: string; status?: number; duration: number };

export type AppProps = {
  configureConnection?: (connection: DaemonConnection) => Promise<DaemonConnection>;
  initialEndpoint?: string;
  autoConnect?: boolean;
  clearTokenOnConnect?: boolean;
  runtimeLabel?: string;
  waitingGuidance?: string;
  desktopLayout?: boolean;
};

const identityConnection = async (connection: DaemonConnection) => connection;
const androidGuidance =
  'Start the daemon in Termux, then connect to http://127.0.0.1:4747. The preview appears after the protocol handshake.';

function formatDate(
  date: Date | null | undefined,
  pattern: string | undefined,
): string | undefined {
  if (!date) return undefined;
  return format(date, pattern ?? 'yyyy-MM-dd');
}

function PreviewSession({
  connection,
  waitingGuidance,
}: {
  connection: DaemonConnection;
  waitingGuidance: string;
}) {
  const state = useDaemon(connection);
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [previewError, setPreviewError] = useState<string>();
  const alive = useRef(true);
  const pending = useRef(new Set<AbortController>());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const controller of pending.current) controller.abort();
      pending.current.clear();
    };
  }, []);
  useEffect(() => setPreviewError(undefined), [state.generation]);

  const instrumentedFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (!alive.current) throw new Error('Preview session closed');
      const started = Date.now();
      const url = requestUrl(input);
      const method =
        init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
      const controller = new AbortController();
      const upstream =
        init?.signal ?? (typeof input === 'object' && 'signal' in input ? input.signal : undefined);
      const abort = () => controller.abort();
      upstream?.addEventListener('abort', abort);
      if (upstream?.aborted) controller.abort();
      pending.current.add(controller);
      let status: number | undefined;
      try {
        const response = await fetchWithDaemonAuth(connection, input, {
          ...init,
          signal: controller.signal,
        });
        if (!alive.current) throw new Error('Preview session closed');
        status = response.status;
        return response;
      } finally {
        pending.current.delete(controller);
        upstream?.removeEventListener('abort', abort);
        if (alive.current) {
          // Record metadata only. Never consume the response body or retain headers/tokens.
          setRequests((current) =>
            [{ method, url, status, duration: Date.now() - started }, ...current].slice(0, 20),
          );
        }
      }
    },
    [connection],
  );

  const entrypoint = state.project
    ? `${connection.endpoint}/preview${state.project.entrypoint}`
    : undefined;
  return (
    <>
      <View style={styles.status}>
        <Text
          accessibilityLiveRegion="polite"
          style={state.phase === 'live' ? styles.online : styles.offline}
        >
          {state.message}
        </Text>
        {previewError ? <Text style={styles.offline}>{previewError}</Text> : null}
      </View>
      <View style={styles.preview}>
        {entrypoint && state.generation > 0 ? (
          <NavigationContainer key={state.generation}>
            <Hyperview
              entrypointUrl={entrypoint}
              fetch={instrumentedFetch}
              formatDate={formatDate}
              onError={() => {
                if (alive.current)
                  setPreviewError(
                    'Preview failed to load. Check HXML and the network inspector, then reconnect.',
                  );
              }}
            />
          </NavigationContainer>
        ) : (
          <Text style={styles.waiting}>{waitingGuidance}</Text>
        )}
      </View>
      <View style={styles.inspector}>
        <Text style={styles.inspectorTitle}>NETWORK · {requests.length}</Text>
        {requests.slice(0, 2).map((request, index) => (
          <Text style={styles.request} key={`${request.url}-${index}`}>
            {request.method} {request.status ?? 'ERR'} {request.duration}ms {request.url}
          </Text>
        ))}
      </View>
    </>
  );
}

export default function App({
  configureConnection = identityConnection,
  initialEndpoint = DAEMON_URL,
  autoConnect = true,
  clearTokenOnConnect = false,
  runtimeLabel = 'NATIVE PREVIEW',
  waitingGuidance = androidGuidance,
  desktopLayout = false,
}: AppProps = {}) {
  const [endpoint, setEndpoint] = useState(initialEndpoint);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string>();
  const [connecting, setConnecting] = useState(false);
  const [session, setSession] = useState<{ id: number; connection: DaemonConnection }>();
  const attempt = useRef(0);
  const { width } = useWindowDimensions();
  const wide = desktopLayout && width >= 800;
  const establishConnection = useCallback(
    async (candidate: DaemonConnection) => {
      const id = ++attempt.current;
      setConnecting(true);
      setError(undefined);
      // Retire the old renderer session before the host changes its proxy origin.
      setSession(undefined);
      try {
        const normalized = normalizeEndpoint(candidate.endpoint);
        if (/[\r\n]/.test(candidate.token))
          throw new Error('The token must not contain line breaks.');
        const connection = await configureConnection({
          endpoint: normalized,
          token: candidate.token.trim(),
        });
        if (id !== attempt.current) return;
        setSession({ id, connection });
        if (clearTokenOnConnect) setToken('');
      } catch (problem) {
        if (id === attempt.current)
          setError(
            problem instanceof Error ? problem.message : 'Could not configure daemon connection.',
          );
      } finally {
        if (id === attempt.current) setConnecting(false);
      }
    },
    [configureConnection, clearTokenOnConnect],
  );
  useEffect(() => {
    if (autoConnect) void establishConnection({ endpoint: initialEndpoint, token: '' });
    return () => {
      attempt.current += 1;
    };
  }, [autoConnect, initialEndpoint, establishConnection]);
  const connect = () => {
    if (!connecting) void establishConnection({ endpoint, token });
  };
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.root}>
          <StatusBar barStyle="light-content" backgroundColor="#080b0f" />
          <View style={styles.header}>
            <Text style={styles.brand}>
              hypir<Text style={styles.accent}>.</Text>
            </Text>
            <Text style={styles.inspectorTitle}>{runtimeLabel}</Text>
          </View>
          <View style={[styles.settings, wide && styles.wideSettings]}>
            <TextInput
              accessibilityLabel="Daemon URL"
              style={[styles.input, wide && styles.wideEndpoint]}
              value={endpoint}
              onChangeText={setEndpoint}
              editable={!connecting}
              onSubmitEditing={connect}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://127.0.0.1:4747"
              placeholderTextColor="#87909b"
            />
            <View style={[styles.credentials, wide && styles.wideCredentials]}>
              <TextInput
                accessibilityLabel="Optional daemon token"
                style={[styles.input, styles.token]}
                value={token}
                onChangeText={setToken}
                editable={!connecting}
                onSubmitEditing={connect}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                placeholder="Optional token (memory only)"
                placeholderTextColor="#87909b"
              />
              <Button
                title={connecting ? 'Connecting…' : 'Connect'}
                disabled={connecting}
                onPress={connect}
                color="#41630b"
              />
            </View>
          </View>
          {error ? (
            <Text accessibilityLiveRegion="polite" style={[styles.offline, styles.status]}>
              {error}
            </Text>
          ) : null}
          {session ? (
            <PreviewSession
              key={session.id}
              connection={session.connection}
              waitingGuidance={waitingGuidance}
            />
          ) : (
            <View style={styles.preview}>
              <Text accessibilityLiveRegion="polite" style={styles.waiting}>
                {connecting ? 'Configuring daemon connection…' : waitingGuidance}
              </Text>
            </View>
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080b0f' },
  header: {
    height: 48,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#202832',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { color: '#f2f5f1', fontSize: 22, fontWeight: '700' },
  accent: { color: '#b9f34a' },
  settings: { padding: 10, gap: 6 },
  wideSettings: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  wideEndpoint: { flex: 1 },
  wideCredentials: { flex: 1 },
  credentials: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    color: '#f2f5f1',
    backgroundColor: '#18202a',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
  },
  token: { flex: 1 },
  status: { paddingHorizontal: 12, paddingBottom: 8 },
  online: { color: '#b9f34a', fontSize: 11 },
  offline: { color: '#ff9977', fontSize: 11 },
  preview: { flex: 1, backgroundColor: '#ffffff' },
  waiting: { color: '#46515f', padding: 24, fontSize: 15 },
  inspector: {
    minHeight: 84,
    backgroundColor: '#0e1319',
    borderTopWidth: 1,
    borderTopColor: '#202832',
    padding: 12,
  },
  inspectorTitle: { color: '#87909b', fontSize: 10, marginBottom: 6 },
  request: { color: '#b8c0c7', fontFamily: 'monospace', fontSize: 9, marginTop: 5 },
});
