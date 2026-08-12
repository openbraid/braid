// Shared quit state — when true, the close interceptor in index.ts lets the window close.
let forceQuit = false

export function getForceQuit(): boolean {
  return forceQuit
}

export function setForceQuit(value: boolean): void {
  forceQuit = value
}
