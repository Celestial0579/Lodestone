// xterm decides at load time whether it can schedule work through postMessage
// and, if the global has one, listens for the message on the global itself. The
// jsdom the tests run in has postMessage on its window but Node's global object
// has no addEventListener, so xterm fails to load. Hand the global the one of
// the window. Import this before anything that imports xterm.
if (typeof globalThis.addEventListener !== 'function') {
  Object.assign(globalThis, {
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
  })
}

// jsdom has no matchMedia, which xterm follows the pixel ratio with, and no
// canvas, which it only probes for.
Object.assign(window, {
  matchMedia: () =>
    Object.assign(new EventTarget(), {
      matches: false,
      addListener: () => {},
      removeListener: () => {},
    }),
})
HTMLCanvasElement.prototype.getContext = () => null
