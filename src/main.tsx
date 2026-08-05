import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {FloatingCompanion} from './components/FloatingCompanion.tsx';
import './index.css';

const companionMode = new URLSearchParams(window.location.search).get('mode') === 'companion';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {companionMode ? <FloatingCompanion /> : <App />}
  </StrictMode>,
);
