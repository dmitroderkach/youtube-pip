/// <reference types="vite/client" />

declare module '*.css?raw' {
  const content: string;
  export default content;
}

// Vite define injection
declare const SCRIPT_VERSION: string;
