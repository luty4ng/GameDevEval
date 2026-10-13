import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import CloudApp from './CloudApp';
import './styles.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode>{import.meta.env.VITE_STORAGE_MODE === 'server' ? <CloudApp /> : <App />}</React.StrictMode>);
