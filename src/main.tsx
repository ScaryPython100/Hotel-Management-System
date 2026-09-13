// Prevent circular structure serialization errors across iframe boundaries
function sanitizeConsoleArg(arg: any, depth = 0, seen = new WeakSet()): any {
  if (arg === null || typeof arg !== 'object') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (seen.has(arg) || depth > 3) return '[Circular/Complex]';
  seen.add(arg);

  if (Array.isArray(arg)) {
    return arg.slice(0, 20).map(item => sanitizeConsoleArg(item, depth + 1, seen));
  }

  const safeObj: Record<string, any> = {};
  for (const key of Object.keys(arg).slice(0, 25)) {
    try {
      const val = arg[key];
      safeObj[key] = sanitizeConsoleArg(val, depth + 1, seen);
    } catch {
      safeObj[key] = '[Inaccessible]';
    }
  }
  return safeObj;
}

const originalWarn = console.warn;
const originalError = console.error;

console.warn = (...args: any[]) => {
  try {
    originalWarn.apply(console, args.map(a => sanitizeConsoleArg(a)));
  } catch {
    originalWarn.apply(console, args.map(a => typeof a === 'object' ? (a?.message || String(a)) : a));
  }
};

console.error = (...args: any[]) => {
  try {
    originalError.apply(console, args.map(a => sanitizeConsoleArg(a)));
  } catch {
    originalError.apply(console, args.map(a => typeof a === 'object' ? (a?.message || String(a)) : a));
  }
};

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
