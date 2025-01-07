document.getElementById('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  attemptLogin();
});

function toggleCheckbox() {
  const checkbox = document.getElementById('remember-me');
  checkbox.checked = !checkbox.checked;
}

function setLoadingState(isLoading) {
  const loginButton = document.querySelector('button[type="submit"]');
  if (isLoading) {
    loginButton.disabled = true;
    loginButton.style.opacity = '0.7';
    loginButton.textContent = 'Logging in...';
  } else {
    loginButton.disabled = false;
    loginButton.style.opacity = '1';
    loginButton.textContent = 'Login';
  }
}

async function attemptLogin() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const rememberMe = document.getElementById('remember-me').checked;
  const messageElement = document.getElementById('message');

  setLoadingState(true);

  try {
    const response = await fetch('https://automaton-login-server-h3kn.onrender.com/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: username,
        password: password,
      }),
    });

    const data = await response.json();
    messageElement.textContent = data.message || 'Processing...';

    if (response.ok) {
      messageElement.style.color = 'green'; // Change color for success message

      // Store credentials if remember me is checked
      if (rememberMe) {
        localStorage.setItem('credentials', JSON.stringify({ username, password }));
      } else {
        localStorage.removeItem('credentials');
      }

      // Wait 2000ms before proceeding
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Notify electron of successful login
      window.electron.ipcRenderer.send('login-success');
    } else {
      messageElement.style.color = 'var(--error-message)'; // Reset to error color
      messageElement.textContent = data.message || 'Login failed. Please check your credentials.';
      setLoadingState(false);
    }
  } catch (error) {
    console.error('Login error:', error);
    messageElement.style.color = 'var(--error-message)';
    messageElement.textContent = 'Connection error. Please try again later.';
    setLoadingState(false);
  }
}

// Load saved credentials but don't auto-login
const credentials = JSON.parse(localStorage.getItem('credentials'));
if (credentials) {
  document.getElementById('username').value = credentials.username;
  document.getElementById('password').value = credentials.password;
  document.getElementById('remember-me').checked = true;
}
