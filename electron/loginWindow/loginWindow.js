document.getElementById('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  // Validate credentials
  if (username === 'admin' && password === 'admin') {
    window.electron.ipcRenderer.send('login-success');
  } else {
    document.getElementById('message').textContent = 'Invalid credentials.';
  }
});
