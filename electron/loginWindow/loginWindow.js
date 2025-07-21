document.getElementById('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  attemptLogin();
});

let currentHardwareId = null;
let resetTimer = null;
let autoLoginTimeout = null;

function toggleCheckbox(checkboxId) {
  const checkbox = document.getElementById(checkboxId);
  if (checkbox) {
    checkbox.checked = !checkbox.checked;
  }
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
    currentHardwareId =
      await window.electron.ipcRenderer.invoke('get-hardware-id');

    if (!currentHardwareId || currentHardwareId.includes('error')) {
      throw new Error('Invalid hardware ID');
    }

    const storedHardwareId = localStorage.getItem('validHardwareId');
    const shortId =
      currentHardwareId.length > 53
        ? `${currentHardwareId.slice(-10)}`
        : currentHardwareId;
    hardwareIdElement.textContent = shortId;
    hardwareIdElement.title = `Device Fingerprint: ${currentHardwareId}`;

    if (storedHardwareId) {
      const isMatch = currentHardwareId === storedHardwareId;
      hardwareIdElement.classList.toggle('valid', isMatch);
      hardwareIdElement.classList.toggle('invalid', !isMatch);
      if (!isMatch)
        showButtonMessage('New device detected', 'var(--error-message)');
    }
  } catch (error) {
    console.error('Hardware check failed:', error);
    hardwareIdElement.textContent = 'ID UNAVAILABLE';
    hardwareIdElement.classList.add('invalid');
    showButtonMessage('Device verification failed', 'var(--error-message)');
  }
}

async function attemptLogin() {
  if (autoLoginTimeout) {
    clearTimeout(autoLoginTimeout);
    autoLoginTimeout = null;
  }

  const loginButton = document.querySelector('button[type="submit"]');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const rememberMeCheckbox = document.getElementById('remember-me');
  const autoLoginCheckbox = document.getElementById('auto-login');

  const username = usernameInput.value;
  const password = passwordInput.value;
  const rememberMe = rememberMeCheckbox.checked;
  const autoLogin = autoLoginCheckbox.checked;

  setLoadingState(true);

  try {
    const response = await fetch(
      'https://automaton-login-server-h3kn.onrender.com/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': currentHardwareId,
        },
        body: JSON.stringify({
          email: username,
          password: password,
          hardwareId: currentHardwareId,
        }),
      },
    );

    const data = await response.json();

    if (response.ok) {
      localStorage.setItem('validHardwareId', currentHardwareId);
      if (rememberMe) {
        localStorage.setItem(
          'credentials',
          JSON.stringify({ username, password }),
        );
        if (autoLogin) {
          localStorage.setItem('autoLoginEnabled', 'true');
        } else {
          localStorage.removeItem('autoLoginEnabled');
        }
      } else {
        localStorage.removeItem('credentials');
        localStorage.removeItem('autoLoginEnabled');
      }
      showButtonMessage(data.message || 'Login successful!', '#00ff00');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      window.electron.ipcRenderer.send('login-success');
    } else {
      showButtonMessage(
        data.message || `Error: ${response.status}`,
        'var(--error-message)',
      );
    }
  } catch (error) {
    showButtonMessage(
      'Connection error. Please try again.',
      'var(--error-message)',
    );
  } finally {
    setLoadingState(false);
  }
}

function cancelAutoLogin() {
  if (autoLoginTimeout) {
    clearTimeout(autoLoginTimeout);
    autoLoginTimeout = null;
    console.log('Auto-login cancelled due to user interaction.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const rememberMeCheckbox = document.getElementById('remember-me');
  const autoLoginCheckbox = document.getElementById('auto-login');
  const loginButton = document.querySelector('button[type="submit"]');

  const credentials = JSON.parse(localStorage.getItem('credentials'));
  const autoLoginEnabled = localStorage.getItem('autoLoginEnabled') === 'true';

  if (credentials) {
    usernameInput.value = credentials.username;
    passwordInput.value = credentials.password;
    rememberMeCheckbox.checked = true;
    autoLoginCheckbox.checked = autoLoginEnabled;
  }

  checkHardwareId();

  if (credentials && autoLoginEnabled) {
    console.log('Auto-login enabled. Starting 1s timer...');
    autoLoginTimeout = setTimeout(() => {
      console.log('Auto-login timer expired. Attempting login...');
      autoLoginTimeout = null;
      attemptLogin();
    }, 1000);
  }

  usernameInput.addEventListener('input', cancelAutoLogin);
  passwordInput.addEventListener('input', cancelAutoLogin);
  loginButton.addEventListener('click', cancelAutoLogin);
  rememberMeCheckbox.addEventListener('change', cancelAutoLogin);
  autoLoginCheckbox.addEventListener('change', cancelAutoLogin);

  usernameInput.focus();
});
