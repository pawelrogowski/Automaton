document.getElementById('login-form').addEventListener('submit', (e) => {
  e.preventDefault();

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
});

function toggleCheckbox() {
  const checkbox = document.getElementById('remember-me');
  checkbox.checked = !checkbox.checked;
}

// Pre-populate fields if "Remember Me" was selected previously
const credentials = JSON.parse(localStorage.getItem('credentials'));
if (credentials) {
  document.getElementById('username').value = credentials.username;
  document.getElementById('password').value = credentials.password;
  document.getElementById('remember-me').checked = true;
}
