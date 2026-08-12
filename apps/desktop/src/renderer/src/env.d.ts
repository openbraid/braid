/// <reference types="vite/client" />

// Electron <webview> JSX element type declaration
declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string
      preload?: string
      nodeintegration?: boolean
      webpreferences?: string
      allowpopups?: boolean
      partition?: string
    }
  }
}
