import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import Hyperview from 'hyperview';
import EventSource from 'react-native-sse';
import { DAEMON_URL } from './config';

type RequestRecord = { method: string; url: string; status?: number; duration?: number };

export default function App() {
  const [revision, setRevision] = useState(0);
  const [connected, setConnected] = useState(false);
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const entrypointUrl = `${DAEMON_URL}/preview/index.xml?revision=${revision}`;

  useEffect(() => {
    const events = new EventSource(`${DAEMON_URL}/api/events`);
    events.addEventListener('daemon.connected', () => setConnected(true));
    events.addEventListener('preview.invalidate', (message) => {
      const event = JSON.parse(message.data ?? '{}');
      setRevision(event.payload?.revision ?? Date.now());
    });
    events.addEventListener('error', () => setConnected(false));
    return () => events.close();
  }, []);

  const instrumentedFetch = useCallback(async (url: RequestInfo | URL, init?: RequestInit) => {
    const started = Date.now();
    const method = init?.method ?? 'GET';
    try {
      const response = await fetch(url, init);
      setRequests((current) => [{ method, url: String(url), status: response.status, duration: Date.now() - started }, ...current].slice(0, 20));
      return response;
    } catch (error) {
      setRequests((current) => [{ method, url: String(url), duration: Date.now() - started }, ...current].slice(0, 20));
      throw error;
    }
  }, []);

  const preview = useMemo(() => <Hyperview key={revision} entrypointUrl={entrypointUrl} fetch={instrumentedFetch} />, [entrypointUrl, instrumentedFetch, revision]);

  return <SafeAreaView style={styles.root}>
    <StatusBar barStyle="light-content" backgroundColor="#080b0f" />
    <View style={styles.header}><Text style={styles.brand}>hypir<Text style={styles.accent}>.</Text></Text><Text style={connected ? styles.online : styles.offline}>● {connected ? 'LIVE' : 'DAEMON OFFLINE'}</Text></View>
    <View style={styles.preview}>{preview}</View>
    <View style={styles.inspector}><Text style={styles.inspectorTitle}>NETWORK · {requests.length}</Text>{requests.slice(0, 2).map((request, index) => <Text style={styles.request} key={`${request.url}-${index}`}>{request.method}  {request.status ?? 'ERR'}  {request.duration}ms  {request.url}</Text>)}</View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080b0f' },
  header: { height: 54, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: '#202832', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: '#f2f5f1', fontSize: 22, fontWeight: '700' }, accent: { color: '#b9f34a' },
  online: { color: '#b9f34a', fontSize: 10 }, offline: { color: '#ff7144', fontSize: 10 },
  preview: { flex: 1, backgroundColor: '#ffffff' },
  inspector: { minHeight: 92, backgroundColor: '#0e1319', borderTopWidth: 1, borderTopColor: '#202832', padding: 12 },
  inspectorTitle: { color: '#87909b', fontSize: 10, marginBottom: 8 },
  request: { color: '#b8c0c7', fontFamily: 'monospace', fontSize: 9, marginTop: 5 },
});
