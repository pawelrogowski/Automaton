document.getElementById('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  attemptLogin();
});

let currentHardwareId = null;
let resetTimer = null;

function toggleCheckbox() {
  const checkbox = document.getElementById('remember-me');
  checkbox.checked = !checkbox.checked;
}

function setLoadingState(isLoading) {
  const loginButton = document.querySelector('button[type="submit"]');
  loginButton.disabled = isLoading;
  loginButton.style.opacity = isLoading ? '0.7' : '1';
  if (isLoading) {
    loginButton.textContent = 'Authenticating...';
  }
}

function showButtonMessage(message, color) {
  const loginButton = document.querySelector('button[type="submit"]');
  clearTimeout(resetTimer);
  loginButton.textContent = message;
  loginButton.style.color = color;
  resetTimer = setTimeout(() => {
    loginButton.textContent = 'Login';
    loginButton.style.color = '';
  }, 10000);
}

async function checkHardwareId() {
  const hardwareIdElement = document.getElementById('hardware-id');
  try {
    hardwareIdElement.classList.remove('valid', 'invalid');
    currentHardwareId = await window.electron.ipcRenderer.invoke('get-hardware-id');

    if (!currentHardwareId || currentHardwareId.includes('error')) {
      throw new Error('Invalid hardware ID');
    }

    const storedHardwareId = localStorage.getItem('validHardwareId');
    hardwareIdElement.textContent = `${currentHardwareId.slice(0, 55)}...`;
    hardwareIdElement.title = `Device Fingerprint: ${currentHardwareId}`;

    if (storedHardwareId) {
      const isMatch = currentHardwareId === storedHardwareId;
      hardwareIdElement.classList.toggle('valid', isMatch);
      hardwareIdElement.classList.toggle('invalid', !isMatch);
      if (!isMatch) showButtonMessage('New device detected', 'var(--error-message)');
    }
  } catch (error) {
    console.error('Hardware check failed:', error);
    hardwareIdElement.textContent = 'ID UNAVAILABLE';
    hardwareIdElement.classList.add('invalid');
    showButtonMessage('Device verification failed', 'var(--error-message)');
  }
}

async function attemptLogin() {
  const loginButton = document.querySelector('button[type="submit"]');
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const rememberMe = document.getElementById('remember-me').checked;

  setLoadingState(true);

  try {
    const response = await fetch('https://automaton-login-server-h3kn.onrender.com/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': currentHardwareId,
      },
      body: JSON.stringify({
        email: username,
        password: password,
        hardwareId: currentHardwareId, // This is the key line that adds hardwareId to the request
      }),
    });

    const data = await response.json();

    if (response.ok) {
      localStorage.setItem('validHardwareId', currentHardwareId);
      if (rememberMe) {
        localStorage.setItem('credentials', JSON.stringify({ username, password }));
      }
      showButtonMessage(data.message || 'Login successful!', '#00ff00');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      window.electron.ipcRenderer.send('login-success');
    } else {
      showButtonMessage(data.message || `Error: ${response.status}`, 'var(--error-message)');
    }
  } catch (error) {
    showButtonMessage('Connection error. Please try again.', 'var(--error-message)');
  } finally {
    setLoadingState(false);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const credentials = JSON.parse(localStorage.getItem('credentials'));
  if (credentials) {
    document.getElementById('username').value = credentials.username;
    document.getElementById('password').value = credentials.password;
    document.getElementById('remember-me').checked = true;
  }

  await checkHardwareId();
  document.getElementById('username').focus();
});
