/// <reference types="vite/client" />
import type { SimuladorBridge } from '@simulador/shared';

declare global {
  interface Window {
    simulador: SimuladorBridge;
  }
  // Replaced at build time by Vite's `define` from the root package.json.
  const __APP_VERSION__: string;
}

export {};
