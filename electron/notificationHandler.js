import { Notification, nativeImage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import store from './store.js';

let notiEnabled = false;

const __filenamePath = fileURLToPath(import.meta.url);
const __dirnamePath = path.dirname(__filenamePath);

const iconPath = path.join(__dirnamePath, 'icons', 'skull.png');

store.subscribe(() => {
  const state = store.getState();
  const { global } = state;
  const { notificationsEnabled } = global;
  notiEnabled = notificationsEnabled;
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
  console.log(notiEnabled);
  if (notiEnabled) return;

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
