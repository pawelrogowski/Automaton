document.getElementById('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  attemptLogin();
});

function toggleCheckbox() {
  const checkbox = document.getElementById('remember-me');
  checkbox.checked = !checkbox.checked;
}

function attemptLogin() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const rememberMe = document.getElementById('remember-me').checked;

  if (username === 'admin@admin' && password === 'admin') {
    if (rememberMe) {
      localStorage.setItem('credentials', JSON.stringify({ username, password }));
    } else {
      localStorage.removeItem('credentials');
    }

    window.electron.ipcRenderer.send('login-success');
  } else {
    document.getElementById('message').textContent = 'Invalid credentials.';
  }
}

// Load saved credentials and attempt auto-login
const credentials = JSON.parse(localStorage.getItem('credentials'));
if (credentials) {
  document.getElementById('username').value = credentials.username;
  document.getElementById('password').value = credentials.password;
  document.getElementById('remember-me').checked = true;

  // Attempt auto-login
  attemptLogin();
}
