import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure the application runs in production mode
process.env.NODE_ENV = 'production';
process.env.PORT = '3000';

// Require the compiled CommonJS Express bundle
import('./dist/server.cjs')
  .then(() => {
    console.log('[Electron Main] Express server started successfully on port 3000.');
  })
  .catch((err) => {
    console.error('[Electron Main] Failed to start Express server:', err);
  });

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "SHREE Desktop Companion",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Delay the browser loading by 1.5 seconds to give the server ample time to stand up
  setTimeout(() => {
    mainWindow.loadURL('http://localhost:3000');
  }, 1500);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
