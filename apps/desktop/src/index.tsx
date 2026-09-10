import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '@hypir/client';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');

createRoot(root).render(
  <App
    configureConnection={window.hypir.connect}
    autoConnect={false}
    clearTokenOnConnect
    desktopLayout
    runtimeLabel="DESKTOP PREVIEW"
    waitingGuidance="Start the daemon on Linux with npm run dev from the hypir repository, then connect to http://127.0.0.1:4747. The preview appears after the protocol handshake."
  />,
);
