import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { LlmStatusProvider } from './context/LlmStatusContext.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <LlmStatusProvider>
        <App />
      </LlmStatusProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
