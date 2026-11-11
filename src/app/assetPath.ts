// Excalidraw loads its fonts from <EXCALIDRAW_ASSET_PATH>fonts/…; they are
// copied to public/fonts so the app works offline. Set here, before Excalidraw
// is imported, rather than by an inline script the content security policy
// would block.
(window as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/";
