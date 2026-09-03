import { spawn } from 'child_process';
import http from 'http';
import path from 'path';

export function initializeImaBridge() {
  return new Promise((resolve, reject) => {
    console.log('Checking if Ima server is running on port 3001...');
    
    const req = http.get('http://localhost:3001/api/feed', (res) => {
      if (res.statusCode === 200) {
        console.log('Ima server is already active on port 3001.');
        resolve(true);
      } else {
        startServer(resolve, reject);
      }
    }).on('error', () => {
      // Connection refused means server is not running
      startServer(resolve, reject);
    });
  });
}

function startServer(resolve, reject) {
  console.log('Starting Ima backend server on port 3001 as background process...');
  
  // Try to locate index.js relative to this file
  let serverPath = path.join(process.cwd(), 'server', 'index.js');
  
  try {
    const child = spawn('node', [serverPath], {
      detached: true,
      stdio: 'ignore' // We don't need to capture output, letting it run in background
    });
    
    child.unref(); // Allow the parent script to exit without waiting for the server
    
    console.log('Ima background process started successfully.');
    
    // Give it a moment to bind to the port
    setTimeout(() => {
      resolve(true);
    }, 2000);
  } catch (err) {
    console.error('Failed to start Ima server:', err);
    reject(err);
  }
}
