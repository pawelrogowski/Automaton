import { Notification, nativeImage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import store from './store.js';

let notiEnabled = false;

const __filenamePath = fileURLToPath(import.meta.url);
const __dirnamePath = path.dirname(__filenamePath);

const iconPath = path.join(__dirnamePath, 'icons', 'greenSkull.png');

store.subscribe(() => {
  const state = store.getState();
  notiEnabled = state.global.notificationsEnabled;
});

const createIconImage = () => {
  try {
    return nativeImage.createFromPath(iconPath);
  } catch (error) {
    console.error('Error creating icon image:', error);
    return null;
  }
};

export const showNotification = (title, body) => {
  if (!notiEnabled) return;

  try {
    new Notification({
      title: title,
      body: body,
      icon: createIconImage(),
    }).show();
  } catch (error) {
    console.error('Error showing notification:', error);
  }
};
